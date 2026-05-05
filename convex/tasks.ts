import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    githubId: v.string(),
    title: v.string(),
    prompt: v.string(),
    category: v.union(
      v.literal("docs"),
      v.literal("tests"),
      v.literal("bugfix"),
      v.literal("review"),
      v.literal("refactor"),
      v.literal("translation")
    ),
    outputType: v.union(
      v.literal("answer"),
      v.literal("review"),
      v.literal("markdown"),
      v.literal("diff"),
      v.literal("pr_draft")
    ),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high")
    ),
    publicRepoUrl: v.optional(v.string()),
    preferredProvider: v.optional(v.string()),
    preferredModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");

    const now = Date.now();
    return await ctx.db.insert("tasks", {
      projectId: args.projectId,
      maintainerId: user._id,
      title: args.title,
      prompt: args.prompt,
      category: args.category,
      outputType: args.outputType,
      priority: args.priority,
      status: "queued",
      publicRepoUrl: args.publicRepoUrl,
      preferredProvider: args.preferredProvider,
      preferredModel: args.preferredModel,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listByMaintainer = query({
  args: { githubId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) return [];

    return await ctx.db
      .query("tasks")
      .withIndex("by_maintainerId", (q) => q.eq("maintainerId", user._id))
      .collect();
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .collect();
  },
});

export const listQueued = query({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});

export const claim = mutation({
  args: {
    taskId: v.id("tasks"),
    githubId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");
    if (user.role !== "VOLUNTEER") throw new Error("Not a volunteer");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.status !== "queued") throw new Error("Task is not queued");

    await ctx.db.patch(args.taskId, {
      status: "claimed",
      claimedByVolunteerId: user._id,
      updatedAt: Date.now(),
    });
  },
});

export const markRunning = mutation({
  args: {
    taskId: v.id("tasks"),
    githubId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");
    if (task.status !== "claimed") throw new Error("Task is not claimed");

    await ctx.db.patch(args.taskId, {
      status: "running",
      updatedAt: Date.now(),
    });
  },
});

export const complete = mutation({
  args: {
    taskId: v.id("tasks"),
    githubId: v.string(),
    content: v.string(),
    executedByProvider: v.optional(v.string()),
    executedByModel: v.optional(v.string()),
    executionDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");

    const now = Date.now();

    await ctx.db.insert("results", {
      taskId: args.taskId,
      volunteerId: user._id,
      content: args.content,
      status: "submitted",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.patch(args.taskId, {
      status: "completed",
      executedByProvider: args.executedByProvider,
      executedByModel: args.executedByModel,
      executionDurationMs: args.executionDurationMs,
      updatedAt: now,
    });
  },
});

export const updateStream = mutation({
  args: {
    taskId: v.id("tasks"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      streamingContent: args.content,
    });
  },
});

export const followUp = mutation({
  args: {
    parentTaskId: v.id("tasks"),
    githubId: v.string(),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    const parent = await ctx.db.get(args.parentTaskId);
    if (!parent) throw new Error("Task not found");

    // Get previous results to build conversation context
    const previousResults = await ctx.db
      .query("results")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.parentTaskId))
      .collect();

    const conversationContext = previousResults
      .map((r) => `### Previous result:\n${r.content}`)
      .join("\n\n");

    const fullPrompt = `${parent.prompt}\n\n${conversationContext}\n\n### Follow-up:\n${args.prompt}`;

    const now = Date.now();
    // Requeue the parent task with the follow-up prompt so it continues on the same branch
    await ctx.db.patch(args.parentTaskId, {
      status: "queued",
      prompt: fullPrompt,
      claimedByVolunteerId: undefined,
      streamingContent: undefined,
      executedByProvider: undefined,
      executedByModel: undefined,
      executionDurationMs: undefined,
      updatedAt: now,
    });

    const newTaskId = args.parentTaskId;

    return newTaskId;
  },
});

export const requestPR = mutation({
  args: {
    taskId: v.id("tasks"),
    githubId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    // Create a special "pr" task that tells the daemon to push and open a PR
    const now = Date.now();
    await ctx.db.insert("tasks", {
      projectId: task.projectId,
      maintainerId: task.maintainerId,
      title: `[PR] ${task.title}`,
      prompt: `__PROMPTRELAY_FILE_PR__\nBranch: promptrelay/${task._id.replace(/[^a-zA-Z0-9]/g, "-")}\nTitle: ${task.title}`,
      category: task.category,
      outputType: "pr_draft",
      priority: "high",
      status: "queued",
      publicRepoUrl: task.publicRepoUrl,
      parentTaskId: task._id,
      preferredProvider: task.preferredProvider,
      createdAt: now,
      updatedAt: now,
    });
  },
});
