import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createTaskFromGitHub = mutation({
  args: {
    githubRepoFullName: v.string(),
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
    githubIssueUrl: v.optional(v.string()),
    githubCommentId: v.optional(v.number()),
    callerGithubId: v.string(),
    callerGithubUsername: v.string(),
  },
  handler: async (ctx, args) => {
    let project = await ctx.db
      .query("projects")
      .withIndex("by_githubRepo", (q) =>
        q.eq("githubRepoFullName", args.githubRepoFullName)
      )
      .unique();

    const now = Date.now();

    if (!project) {
      // Auto-link: find or create the user, then create the project
      let user = await ctx.db
        .query("users")
        .withIndex("by_githubId", (q) => q.eq("githubId", args.callerGithubId))
        .unique();

      if (!user) {
        const userId = await ctx.db.insert("users", {
          githubId: args.callerGithubId,
          githubUsername: args.callerGithubUsername,
          roles: ["MAINTAINER"],
          createdAt: now,
          updatedAt: now,
        });
        user = (await ctx.db.get(userId))!;
      }

      const projectId = await ctx.db.insert("projects", {
        name: args.githubRepoFullName.split("/")[1],
        githubRepoFullName: args.githubRepoFullName,
        repoUrl: `https://github.com/${args.githubRepoFullName}`,
        maintainerId: user._id,
        createdAt: now,
        updatedAt: now,
      });
      project = (await ctx.db.get(projectId))!;
    }

    return await ctx.db.insert("tasks", {
      projectId: project._id,
      maintainerId: project.maintainerId,
      title: args.title,
      prompt: args.prompt,
      category: args.category,
      outputType: args.outputType,
      priority: args.priority,
      status: "queued",
      publicRepoUrl: `https://github.com/${args.githubRepoFullName}`,
      githubIssueUrl: args.githubIssueUrl,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getLinkedProject = query({
  args: { githubRepoFullName: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projects")
      .withIndex("by_githubRepo", (q) =>
        q.eq("githubRepoFullName", args.githubRepoFullName)
      )
      .unique();
  },
});
