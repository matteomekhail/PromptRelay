import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { requireCurrentUser } from "./lib/auth";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;

export const listByTask = query({
  args: { taskId: v.id("tasks"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireCurrentUser(ctx);

    return await ctx.db
      .query("results")
      .withIndex("by_taskId", (q) => q.eq("taskId", args.taskId))
      .take(boundedLimit(args.limit));
  },
});

export const accept = mutation({
  args: {
    resultId: v.id("results"),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

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
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);

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
      claimExpiresAt: undefined,
      updatedAt: Date.now(),
    });
  },
});

function boundedLimit(limit?: number) {
  return Math.min(Math.max(limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);
}
