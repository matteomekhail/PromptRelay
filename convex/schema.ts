import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.optional(v.string()),
    githubId: v.string(),
    githubUsername: v.string(),
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    avatarUrl: v.optional(v.string()),
    role: v.optional(v.union(v.literal("MAINTAINER"), v.literal("VOLUNTEER"))),
    roles: v.optional(v.array(v.union(v.literal("MAINTAINER"), v.literal("VOLUNTEER")))),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_githubId", ["githubId"])
    .index("by_tokenIdentifier", ["tokenIdentifier"]),

  projects: defineTable({
    name: v.string(),
    description: v.optional(v.string()),
    repoUrl: v.optional(v.string()),
    githubRepoFullName: v.optional(v.string()),
    githubRepoId: v.optional(v.number()),
    maintainerId: v.id("users"),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_maintainerId", ["maintainerId"])
    .index("by_githubRepo", ["githubRepoFullName"]),

  tasks: defineTable({
    projectId: v.id("projects"),
    maintainerId: v.id("users"),
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
    status: v.union(
      v.literal("queued"),
      v.literal("claimed"),
      v.literal("running"),
      v.literal("completed"),
      v.literal("rejected"),
      v.literal("failed")
    ),
    publicRepoUrl: v.optional(v.string()),
    githubIssueUrl: v.optional(v.string()),
    parentTaskId: v.optional(v.id("tasks")),
    preferredProvider: v.optional(v.string()),
    preferredModel: v.optional(v.string()),
    claimedByVolunteerId: v.optional(v.id("users")),
    claimExpiresAt: v.optional(v.number()),
    attempts: v.optional(v.number()),
    failedReason: v.optional(v.string()),
    streamingContent: v.optional(v.string()),
    executedByProvider: v.optional(v.string()),
    executedByModel: v.optional(v.string()),
    executionDurationMs: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_maintainerId", ["maintainerId"])
    .index("by_status", ["status"])
    .index("by_status_and_claimExpiresAt", ["status", "claimExpiresAt"])
    .index("by_projectId", ["projectId"]),

  volunteerSettings: defineTable({
    volunteerId: v.id("users"),
    maxTasksPerDay: v.number(),
    allowedCategories: v.array(v.string()),
    availableProviders: v.optional(v.array(v.string())),
    manualApprovalOnly: v.boolean(),
    trustedProjects: v.array(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_volunteerId", ["volunteerId"]),

  results: defineTable({
    taskId: v.id("tasks"),
    volunteerId: v.id("users"),
    content: v.string(),
    status: v.union(
      v.literal("submitted"),
      v.literal("accepted"),
      v.literal("rejected")
    ),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_taskId", ["taskId"])
    .index("by_volunteerId", ["volunteerId"]),
});
