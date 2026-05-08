import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { requireCurrentUser, requireRole } from "./lib/auth";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const RESULTS_CONTEXT_LIMIT = 20;
const CLAIM_TIMEOUT_MS = 30 * 60 * 1000;
const MAX_TASK_ATTEMPTS = 3;
const RECOVERED_DETAILS_LIMIT = 20;

const priorityValidator = v.union(
  v.literal("low"),
  v.literal("normal"),
  v.literal("high")
);

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    prompt: v.string(),
    priority: priorityValidator,
    publicRepoUrl: v.optional(v.string()),
    preferredProvider: v.optional(v.string()),
    preferredModel: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, "MAINTAINER");

    const project = await ctx.db.get(args.projectId);
    if (!project) throw new Error("Project not found");
    if (project.maintainerId !== user._id) throw new Error("Not your project");

    const now = Date.now();
    return await ctx.db.insert("tasks", {
      projectId: args.projectId,
      maintainerId: user._id,
      title: args.title,
      prompt: args.prompt,
      priority: args.priority,
      status: "queued",
      publicRepoUrl: args.publicRepoUrl,
      preferredProvider: args.preferredProvider,
      preferredModel: args.preferredModel,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const listByMaintainer = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    return await ctx.db
      .query("tasks")
      .withIndex("by_maintainerId", (q) => q.eq("maintainerId", user._id))
      .take(boundedLimit(args.limit));
  },
});

export const listByProject = query({
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    return await ctx.db
      .query("tasks")
      .withIndex("by_projectId", (q) => q.eq("projectId", args.projectId))
      .take(boundedLimit(args.limit));
  },
});

export const listQueued = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    return await ctx.db
      .query("tasks")
      .withIndex("by_status", (q) => q.eq("status", "queued"))
      .take(boundedLimit(args.limit));
  },
});

export const get = query({
  args: { id: v.id("tasks") },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    return await ctx.db.get(args.id);
  },
});

export const claim = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, "VOLUNTEER");

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.status !== "queued") throw new Error("Task is not queued");

    const attempts = (task.attempts ?? 0) + 1;
    if (attempts > MAX_TASK_ATTEMPTS) {
      await markTaskFailed(ctx, task._id, "Maximum retry attempts exceeded");
      throw new Error("Task retry limit exceeded");
    }

    await ctx.db.patch(args.taskId, {
      status: "claimed",
      claimedByVolunteerId: user._id,
      claimExpiresAt: Date.now() + CLAIM_TIMEOUT_MS,
      attempts,
      failedReason: undefined,
      updatedAt: Date.now(),
    });
  },
});

export const markRunning = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");
    if (task.status !== "claimed") throw new Error("Task is not claimed");

    await ctx.db.patch(args.taskId, {
      status: "running",
      claimExpiresAt: Date.now() + CLAIM_TIMEOUT_MS,
      lastHeartbeatAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const heartbeat = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");
    if (task.status !== "claimed" && task.status !== "running") {
      throw new Error("Task is not active");
    }

    const now = Date.now();
    await ctx.db.patch(args.taskId, {
      lastHeartbeatAt: now,
      claimExpiresAt: now + CLAIM_TIMEOUT_MS,
      updatedAt: now,
    });
  },
});

export const markAcceptedCommentPosted = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");

    await ctx.db.patch(args.taskId, {
      acceptedCommentPostedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const markInterruptedCommentPosted = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");

    await ctx.db.patch(args.taskId, {
      interruptedCommentPostedAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const complete = mutation({
  args: {
    taskId: v.id("tasks"),
    content: v.string(),
    executedByProvider: v.optional(v.string()),
    executedByModel: v.optional(v.string()),
    executionDurationMs: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");
    if (task.status !== "running" && task.status !== "claimed") {
      throw new Error("Task is not active");
    }

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
      claimExpiresAt: undefined,
      failedReason: undefined,
      streamingContent: undefined,
      lastHeartbeatAt: undefined,
      executedByProvider: args.executedByProvider,
      executedByModel: args.executedByModel,
      executionDurationMs: args.executionDurationMs,
      updatedAt: now,
    });
  },
});

export const fail = mutation({
  args: {
    taskId: v.id("tasks"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");

    await retryOrFail(ctx, task, args.error);
  },
});

export const failTerminal = mutation({
  args: {
    taskId: v.id("tasks"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");

    await markTaskFailed(ctx, task._id, args.error);
  },
});

export const updateStream = mutation({
  args: {
    taskId: v.id("tasks"),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.claimedByVolunteerId !== user._id) throw new Error("Not your task");

    await ctx.db.patch(args.taskId, {
      streamingContent: args.content,
      claimExpiresAt: Date.now() + CLAIM_TIMEOUT_MS,
      updatedAt: Date.now(),
    });
  },
});

export const followUp = mutation({
  args: {
    parentTaskId: v.id("tasks"),
    prompt: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const parent = await ctx.db.get(args.parentTaskId);
    if (!parent) throw new Error("Task not found");
    if (parent.maintainerId !== user._id) throw new Error("Not your task");

    const previousResults = await ctx.db
      .query("results")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.parentTaskId))
      .take(RESULTS_CONTEXT_LIMIT);

    const conversationContext = previousResults
      .map((r) => `### Previous result:\n${r.content}`)
      .join("\n\n");

    const fullPrompt = `${parent.prompt}\n\n${conversationContext}\n\n### Follow-up:\n${args.prompt}`;

    const now = Date.now();
    await ctx.db.patch(args.parentTaskId, {
      status: "queued",
      prompt: fullPrompt,
      claimedByVolunteerId: undefined,
      claimExpiresAt: undefined,
      failedReason: undefined,
      streamingContent: undefined,
      lastHeartbeatAt: undefined,
      executedByProvider: undefined,
      executedByModel: undefined,
      executionDurationMs: undefined,
      updatedAt: now,
    });

    return args.parentTaskId;
  },
});

export const requestPR = mutation({
  args: {
    taskId: v.id("tasks"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

    const task = await ctx.db.get(args.taskId);
    if (!task) throw new Error("Task not found");
    if (task.maintainerId !== user._id) throw new Error("Not your task");

    const now = Date.now();
    await ctx.db.insert("tasks", {
      projectId: task.projectId,
      maintainerId: task.maintainerId,
      title: `[PR] ${task.title}`,
      prompt: `__PROMPTRELAY_FILE_PR__\nBranch: promptrelay/${task._id.replace(/[^a-zA-Z0-9]/g, "-")}\nTitle: ${task.title}`,
      priority: "high",
      status: "queued",
      publicRepoUrl: task.publicRepoUrl,
      parentTaskId: task._id,
      preferredProvider: task.preferredProvider,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const recoverStaleTasks = mutation({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    const now = Date.now();
    const limit = boundedLimit(args.limit);
    const recovered = [
      ...(await recoverStaleByStatus(ctx, "claimed", now, limit)),
      ...(await recoverStaleByStatus(ctx, "running", now, limit)),
    ].slice(0, RECOVERED_DETAILS_LIMIT);
    return { recovered: recovered.length, tasks: recovered };
  },
});

async function recoverStaleByStatus(
  ctx: MutationCtx,
  status: "claimed" | "running",
  now: number,
  limit: number
) {
  const staleTasks = await ctx.db
    .query("tasks")
    .withIndex("by_status_and_claimExpiresAt", (q) =>
      q.eq("status", status).lt("claimExpiresAt", now)
    )
    .take(limit);

  const recovered = [];
  for (const task of staleTasks) {
    await retryOrFail(ctx, task, "Claim expired before completion");
    recovered.push({
      taskId: task._id,
      title: task.title,
      githubIssueUrl: task.githubIssueUrl,
      attempts: task.attempts ?? 0,
      interruptedCommentPostedAt: task.interruptedCommentPostedAt,
    });
  }

  return recovered;
}

async function retryOrFail(ctx: MutationCtx, task: Doc<"tasks">, reason: string) {
  if ((task.attempts ?? 0) >= MAX_TASK_ATTEMPTS) {
    await markTaskFailed(ctx, task._id, reason);
    return;
  }

  await ctx.db.patch(task._id, {
    status: "queued",
    claimedByVolunteerId: undefined,
    claimExpiresAt: undefined,
    failedReason: reason,
    streamingContent: undefined,
    lastHeartbeatAt: undefined,
    updatedAt: Date.now(),
  });
}

async function markTaskFailed(
  ctx: MutationCtx,
  taskId: Id<"tasks">,
  reason: string
) {
  await ctx.db.patch(taskId, {
    status: "failed",
    claimedByVolunteerId: undefined,
    claimExpiresAt: undefined,
    failedReason: reason,
    streamingContent: undefined,
    lastHeartbeatAt: undefined,
    updatedAt: Date.now(),
  });
}

export const currentForVolunteer = query({
  args: {},
  handler: async (ctx) => {
    const user = await requireCurrentUser(ctx);
    return await ctx.db
      .query("tasks")
      .withIndex("by_claimedByVolunteerId_and_status", (q) =>
        q.eq("claimedByVolunteerId", user._id).eq("status", "running")
      )
      .take(5);
  },
});

function boundedLimit(limit?: number) {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}
