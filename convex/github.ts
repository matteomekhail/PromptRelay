import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const createTaskFromGitHub = mutation({
  args: {
    githubRepoFullName: v.string(),
    title: v.string(),
    prompt: v.string(),
    priority: v.union(
      v.literal("low"),
      v.literal("normal"),
      v.literal("high")
    ),
    githubIssueUrl: v.optional(v.string()),
    githubCommentId: v.optional(v.number()),
    callerGithubId: v.string(),
    callerGithubUsername: v.string(),
    webhookSecret: v.string(),
  },
  handler: async (ctx, args) => {
    const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!webhookSecret || args.webhookSecret !== webhookSecret) {
      throw new Error("Invalid webhook secret");
    }

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
