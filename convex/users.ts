import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import {
  getCurrentUser,
  getRoles,
  requireCurrentUser,
  upsertCurrentUser,
} from "./lib/auth";

export const upsertFromGitHub = mutation({
  args: {},
  handler: async (ctx) => {
    return await upsertCurrentUser(ctx);
  },
});

export const current = query({
  args: {},
  handler: async (ctx) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    return { ...user, roles: getRoles(user) };
  },
});

export const setRole = mutation({
  args: {
    role: v.union(v.literal("MAINTAINER"), v.literal("VOLUNTEER")),
  },
  handler: async (ctx, args) => {
    const user = await requireCurrentUser(ctx);
    const roles = new Set(getRoles(user));
    roles.add(args.role);

    await ctx.db.patch(user._id, {
      roles: Array.from(roles),
      updatedAt: Date.now(),
    });

    return user._id;
  },
});
