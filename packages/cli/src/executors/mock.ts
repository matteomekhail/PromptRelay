import type { Executor, TaskPayload, ExecutionResult } from "./types.js";

export class MockExecutor implements Executor {
  name = "mock";
  displayName = "Mock (deterministic, no AI)";

  async isAvailable(): Promise<boolean> {
    return true;
  }

  async execute(task: TaskPayload): Promise<ExecutionResult> {
    const start = Date.now();

    // Simulate processing time
    await new Promise((r) => setTimeout(r, 800 + Math.random() * 1200));

    const content = this.generate(task);
    return {
      content,
      provider: "mock",
      model: "deterministic-v1",
      durationMs: Date.now() - start,
    };
  }

  private generate(task: TaskPayload): string {
    switch (task.outputType) {
      case "answer":
        return this.answer(task);
      case "review":
        return this.review(task);
      case "markdown":
        return this.markdown(task);
      case "diff":
        return this.diff(task);
      case "pr_draft":
        return this.prDraft(task);
      default:
        return `Result for: ${task.title}`;
    }
  }

  private answer(task: TaskPayload): string {
    return `## ${task.title}\n\nBased on analysis of the ${task.category} task:\n\n1. **Primary recommendation:** Implement input validation at the boundary layer before processing.\n2. **Secondary:** Add structured error handling with typed error codes.\n3. **Testing:** Cover the main path and two edge cases (empty input, malformed payload).\n\nThis follows established patterns in the codebase and addresses the core requirements in the prompt.`;
  }

  private review(task: TaskPayload): string {
    return `## Code Review: ${task.title}\n\n**Observations:**\n- Structure follows project conventions\n- Error handling covers primary failure modes\n- Consider adding input validation for null/undefined edge cases\n- Retry logic would benefit from exponential backoff\n\n**Risks:**\n- Medium: potential race condition under concurrent access\n- Low: unbounded result sets without pagination\n\n**Verdict:** Approve with suggestions.`;
  }

  private markdown(task: TaskPayload): string {
    const project = task.projectName ?? "project";
    return `# ${task.title}\n\n## Overview\n\n${task.prompt.slice(0, 120)}...\n\n## Usage\n\n\`\`\`typescript\nimport { create } from '${project}';\n\nconst instance = create({ timeout: 5000, retries: 3 });\nawait instance.run();\n\`\`\`\n\n## API\n\n| Method | Returns | Description |\n|--------|---------|-------------|\n| \`create(opts)\` | Instance | Create configured instance |\n| \`run()\` | Promise<Result> | Execute main operation |\n| \`stop()\` | void | Graceful shutdown |`;
  }

  private diff(task: TaskPayload): string {
    return `diff --git a/src/handler.ts b/src/handler.ts\nindex 1a2b3c4..5e6f7g8 100644\n--- a/src/handler.ts\n+++ b/src/handler.ts\n@@ -1,6 +1,10 @@\n+import { validate } from './utils/validate';\n+\n export async function handle(input: unknown) {\n-  const data = input as Record<string, unknown>;\n+  const data = validate(input);\n+  if (!data) {\n+    throw new Error('Invalid input');\n+  }\n   const result = await process(data);\n-  return result;\n+  return { success: true, data: result, timestamp: Date.now() };\n }`;
  }

  private prDraft(task: TaskPayload): string {
    const project = task.projectName ?? "project";
    return `## PR: ${task.title}\n\n**Summary:**\n- Addresses ${task.category} for ${project}\n- Implements validation and error recovery\n- Adds test coverage for new paths\n\n**Changes:**\n- \`src/handler.ts\`: input validation, typed errors\n- \`src/handler.test.ts\`: edge case coverage\n\n**Checklist:**\n- [x] Compiles\n- [x] Tests pass\n- [x] No breaking changes\n- [ ] Docs updated\n\n**Test:** \`npm test -- --filter="${project}"\``;
  }
}
