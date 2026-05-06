import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { Doc } from "../_generated/dataModel";

export type UserRole = "MAINTAINER" | "VOLUNTEER";

type Ctx = QueryCtx | MutationCtx;

export async function requireIdentity(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) throw new Error("Not authenticated");
  return identity;
}

export async function getCurrentUser(ctx: Ctx) {
  const identity = await ctx.auth.getUserIdentity();
  if (!identity) return null;

  const byToken = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier)
    )
    .unique();
  if (byToken) return byToken;

  const githubId = getGithubId(identity.subject, identity.githubId);
  return await ctx.db
    .query("users")
    .withIndex("by_githubId", (q) => q.eq("githubId", githubId))
    .unique();
}

export async function requireCurrentUser(ctx: Ctx) {
  const user = await getCurrentUser(ctx);
  if (!user) throw new Error("User not found");
  return user;
}

export async function requireRole(ctx: Ctx, role: UserRole) {
  const user = await requireCurrentUser(ctx);
  if (!hasRole(user, role)) throw new Error(`Missing role: ${role}`);
  return user;
}

export function hasRole(user: Doc<"users">, role: UserRole) {
  return getRoles(user).includes(role);
}

export function getRoles(user: Doc<"users">): UserRole[] {
  const roles = new Set<UserRole>();
  for (const role of user.roles ?? []) roles.add(role as UserRole);
  if (user.role) roles.add(user.role as UserRole);
  return Array.from(roles);
}

export async function upsertCurrentUser(ctx: MutationCtx) {
  const identity = await requireIdentity(ctx);
  const githubId = getGithubId(identity.subject, identity.githubId);
  const githubUsername =
    typeof identity.preferredUsername === "string"
      ? identity.preferredUsername
      : typeof identity.nickname === "string"
        ? identity.nickname
        : "";

  const now = Date.now();
  const existingByToken = await ctx.db
    .query("users")
    .withIndex("by_tokenIdentifier", (q) =>
      q.eq("tokenIdentifier", identity.tokenIdentifier)
    )
    .unique();
  const existing =
    existingByToken ??
    (await ctx.db
      .query("users")
      .withIndex("by_githubId", (q) => q.eq("githubId", githubId))
      .unique());

  if (existing) {
    await ctx.db.patch(existing._id, {
      tokenIdentifier: identity.tokenIdentifier,
      githubId,
      githubUsername,
      name: identity.name,
      email: identity.email,
      avatarUrl: identity.pictureUrl,
      updatedAt: now,
    });
    return existing._id;
  }

  return await ctx.db.insert("users", {
    tokenIdentifier: identity.tokenIdentifier,
    githubId,
    githubUsername,
    name: identity.name,
    email: identity.email,
    avatarUrl: identity.pictureUrl,
    roles: [],
    createdAt: now,
    updatedAt: now,
  });
}

function getGithubId(subject: string, claim: unknown) {
  if (typeof claim === "string" && claim.length > 0) return claim;
  return subject.startsWith("github:") ? subject.slice("github:".length) : subject;
}
