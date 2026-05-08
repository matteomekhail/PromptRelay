import type { Executor } from "./types.js";
import { ClaudeCodeExecutor } from "./claude-code.js";
import { CodexExecutor } from "./codex.js";
import { OpenCodeExecutor } from "./opencode.js";

export type { Executor, TaskPayload, ExecutionResult, ProviderConfig } from "./types.js";

const ALL_EXECUTORS: Executor[] = [
  new ClaudeCodeExecutor(),
  new CodexExecutor(),
  new OpenCodeExecutor(),
];

export function getExecutor(name: string): Executor | undefined {
  return ALL_EXECUTORS.find((e) => e.name === name);
}

export function listExecutors(): Executor[] {
  return ALL_EXECUTORS;
}

export async function detectAvailableProviders(): Promise<Executor[]> {
  const results = await Promise.all(
    ALL_EXECUTORS.map(async (e) => ({
      executor: e,
      available: await e.isAvailable(),
    }))
  );
  return results.filter((r) => r.available).map((r) => r.executor);
}

export async function selectExecutor(
  preferred?: string[]
): Promise<Executor | null> {
  // Try preferred providers in order
  if (preferred && preferred.length > 0) {
    for (const name of preferred) {
      const executor = getExecutor(name);
      if (executor && (await executor.isAvailable())) {
        return executor;
      }
    }
  }

  // Fall back to the first available real executor.
  const available = await detectAvailableProviders();
  return available[0] ?? null;
}
