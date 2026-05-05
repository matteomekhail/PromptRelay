import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    githubRepoFullName: v.optional(v.string()),
    githubRepoId: v.optional(v.number()),
    githubId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    const now = Date.now();
    return await ctx.db.insert("projects", {
      name: args.name,
      description: args.description,
      repoUrl: args.repoUrl,
      githubRepoFullName: args.githubRepoFullName,
      githubRepoId: args.githubRepoId,
      maintainerId: user._id,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getByGithubRepo = query({
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

export const listByMaintainer = query({
  args: { githubId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) return [];

    return await ctx.db
      .query("projects")
      .withIndex("by_maintainerId", (q) => q.eq("maintainerId", user._id))
      .collect();
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.id);
  },
});
