import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCurrentUser, requireRole } from "./lib/auth";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    githubRepoFullName: v.optional(v.string()),
    githubRepoId: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const user = await requireRole(ctx, "MAINTAINER");

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
    await requireCurrentUser(ctx);
    return await ctx.db
      .query("projects")
      .withIndex("by_githubRepo", (q) =>
        q.eq("githubRepoFullName", args.githubRepoFullName)
      )
      .unique();
  },
});

export const listByMaintainer = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const limit = boundedLimit(args.limit);

    return await ctx.db
      .query("projects")
      .withIndex("by_maintainerId", (q) => q.eq("maintainerId", user._id))
      .take(limit);
  },
});

export const get = query({
  args: { id: v.id("projects") },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);
    return await ctx.db.get(args.id);
  },
});

function boundedLimit(limit?: number) {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}
