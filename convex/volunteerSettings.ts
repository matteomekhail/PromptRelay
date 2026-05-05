import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const get = query({
  args: { githubId: v.string() },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) return null;

    return await ctx.db
      .query("volunteerSettings")
      .withIndex("by_volunteerId", (q) => q.eq("volunteerId", user._id))
      .unique();
  },
});

export const upsert = mutation({
  args: {
    githubId: v.string(),
    maxTasksPerDay: v.number(),
    allowedCategories: v.array(v.string()),
    trustedProjects: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");
    if (user.role !== "VOLUNTEER") throw new Error("Not a volunteer");

    const existing = await ctx.db
      .query("volunteerSettings")
      .withIndex("by_volunteerId", (q) => q.eq("volunteerId", user._id))
      .unique();

    const now = Date.now();

    if (existing) {
      await ctx.db.patch(existing._id, {
        maxTasksPerDay: args.maxTasksPerDay,
        allowedCategories: args.allowedCategories,
        trustedProjects: args.trustedProjects,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("volunteerSettings", {
      volunteerId: user._id,
      maxTasksPerDay: args.maxTasksPerDay,
      allowedCategories: args.allowedCategories,
      manualApprovalOnly: true,
      trustedProjects: args.trustedProjects,
      createdAt: now,
      updatedAt: now,
    });
  },
});
