import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const upsertFromGitHub = mutation({
  args: {
    githubId: v.string(),
    githubUsername: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        githubUsername: args.githubUsername,
        name: args.name,
        email: args.email,
        avatarUrl: args.avatarUrl,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      githubId: args.githubId,
      githubUsername: args.githubUsername,
      name: args.name,
      email: args.email,
      avatarUrl: args.avatarUrl,
      createdAt: now,
      updatedAt: now,
    });
  },
});

export const getByGithubId = query({
  args: { githubId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();
  },
});

export const setRole = mutation({
  args: {
    githubId: v.string(),
    role: v.union(v.literal("MAINTAINER"), v.literal("VOLUNTEER")),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    await ctx.db.patch(user._id, {
      role: args.role,
      updatedAt: Date.now(),
    });

    return user._id;
  },
});
