import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listByTask = query({
  args: { taskId: v.id("tasks") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("results")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .collect();
  },
});

export const accept = mutation({
  args: {
    resultId: v.id("results"),
    githubId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    const result = await ctx.db.get(args.resultId);
    if (!result) throw new Error("Result not found");

    const task = await ctx.db.get(result.taskId);
    if (!task) throw new Error("Task not found");
    if (task.maintainerId !== user._id) throw new Error("Not your task");

    await ctx.db.patch(args.resultId, {
      status: "accepted",
      updatedAt: Date.now(),
    });
  },
});

export const reject = mutation({
  args: {
    resultId: v.id("results"),
    githubId: v.string(),
  },
  handler: async (ctx, args) => {
    const user = await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", args.githubId))
      .unique();

    if (!user) throw new Error("User not found");

    const result = await ctx.db.get(args.resultId);
    if (!result) throw new Error("Result not found");

    const task = await ctx.db.get(result.taskId);
    if (!task) throw new Error("Task not found");
    if (task.maintainerId !== user._id) throw new Error("Not your task");

    await ctx.db.patch(args.resultId, {
      status: "rejected",
      updatedAt: Date.now(),
    });

    await ctx.db.patch(result.taskId, {
      status: "queued",
      claimedByVolunteerId: undefined,
      updatedAt: Date.now(),
    });
  },
});
