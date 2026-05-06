export interface TaskPayload {
  id: string;
  title: string;
  prompt: string;
  category: string;
  outputType: string;
  projectName?: string;
  publicRepoUrl?: string;
  githubIssueUrl?: string;
}

export interface ExecutionResult {
  content: string;
  provider: string;
  model?: string;
  tokensUsed?: number;
  durationMs: number;
}

export interface Executor {
  name: string;
  displayName: string;
  isAvailable(): Promise<boolean>;
  previewCommand?(task: TaskPayload): string;
  execute(task: TaskPayload): Promise<ExecutionResult>;
}

export type ProviderConfig = {
  provider: string;
  enabled: boolean;
  model?: string;
  maxTokens?: number;
  custom?: Record<string, unknown>;
};
