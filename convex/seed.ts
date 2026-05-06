import { mutation } from "./_generated/server";

export const seedDev = mutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();

    const maintainer = await ctx.db.insert("users", {
      githubId: "dev-maintainer-12345",
      githubUsername: "demo-maintainer",
      name: "Demo Maintainer",
      email: "maintainer@example.com",
      avatarUrl: "https://avatars.githubusercontent.com/u/1?v=4",
      roles: ["MAINTAINER"],
      createdAt: now,
      updatedAt: now,
    });

    const volunteer = await ctx.db.insert("users", {
      githubId: "dev-volunteer-67890",
      githubUsername: "demo-volunteer",
      name: "Demo Volunteer",
      email: "volunteer@example.com",
      avatarUrl: "https://avatars.githubusercontent.com/u/2?v=4",
      roles: ["VOLUNTEER"],
      createdAt: now,
      updatedAt: now,
    });

    const project1 = await ctx.db.insert("projects", {
      name: "open-relay",
      description: "An open-source message relay system for distributed applications",
      repoUrl: "https://github.com/example/open-relay",
      maintainerId: maintainer,
      createdAt: now,
      updatedAt: now,
    });

    const project2 = await ctx.db.insert("projects", {
      name: "fast-cache",
      description: "High-performance caching library with TTL support",
      maintainerId: maintainer,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("tasks", {
      projectId: project1,
      maintainerId: maintainer,
      title: "Write unit tests for the relay handler",
      prompt:
        "Write comprehensive unit tests for the relay handler module in src/relay.ts. Cover edge cases including timeout, retry logic, and malformed payloads.",
      category: "tests",
      outputType: "diff",
      priority: "high",
      status: "queued",
      attempts: 0,
      publicRepoUrl: "https://github.com/example/open-relay",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("tasks", {
      projectId: project1,
      maintainerId: maintainer,
      title: "Review authentication middleware",
      prompt:
        "Review the authentication middleware in src/auth/middleware.ts for security issues, race conditions, and proper error handling.",
      category: "review",
      outputType: "review",
      priority: "normal",
      status: "queued",
      attempts: 0,
      publicRepoUrl: "https://github.com/example/open-relay",
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("tasks", {
      projectId: project2,
      maintainerId: maintainer,
      title: "Generate API documentation",
      prompt:
        "Generate comprehensive markdown API documentation for the fast-cache library covering all public methods, configuration options, and usage examples.",
      category: "docs",
      outputType: "markdown",
      priority: "normal",
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("tasks", {
      projectId: project2,
      maintainerId: maintainer,
      title: "Fix race condition in TTL cleanup",
      prompt:
        "There is a race condition in the TTL cleanup worker where expired entries may be served briefly after expiry. Investigate and provide a fix.",
      category: "bugfix",
      outputType: "pr_draft",
      priority: "high",
      status: "queued",
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    await ctx.db.insert("volunteerSettings", {
      volunteerId: volunteer,
      maxTasksPerDay: 5,
      allowedCategories: ["docs", "tests", "review", "bugfix", "refactor", "translation"],
      manualApprovalOnly: true,
      trustedProjects: [],
      createdAt: now,
      updatedAt: now,
    });

    return { maintainer, volunteer, project1, project2 };
  },
});
