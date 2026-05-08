import { ConvexClient } from "convex/browser";
import { ConvexHttpClient } from "convex/browser";
import type { FunctionReference } from "convex/server";
import { getConfig, getEnabledProviders } from "./config.js";
import { getConvexAuthToken } from "./convex-auth.js";
import { selectExecutor, getExecutor } from "./executors/index.js";
import { ClaudeCodeExecutor } from "./executors/claude-code.js";
import { openForkPullRequest } from "./executors/github-pr.js";
import type { Executor, ExecutionResult, TaskPayload } from "./executors/types.js";

interface QueuedTask {
  _id: string;
  title: string;
  prompt: string;
  priority: string;
  projectId: string;
  publicRepoUrl?: string;
  githubIssueUrl?: string;
  preferredProvider?: string;
  preferredModel?: string;
  status: string;
  acceptedCommentPostedAt?: number;
}

interface RecoveredTask {
  taskId: string;
  title: string;
  githubIssueUrl?: string;
  attempts: number;
  interruptedCommentPostedAt?: number;
}

interface DaemonCallbacks {
  onTaskFound?: (task: QueuedTask) => void;
  onTaskApprovalRequired?: (task: QueuedTask) => boolean | Promise<boolean>;
  onTaskClaimed?: (task: QueuedTask) => void;
  onTaskRunning?: (task: QueuedTask, provider: string) => void;
  onTaskPreview?: (task: QueuedTask, provider: string, command: string) => void;
  onTaskCompleted?: (task: QueuedTask, durationMs: number) => void;
  onTaskError?: (task: QueuedTask, error: Error) => void;
  onIdle?: () => void;
  onError?: (error: Error) => void;
}

export class Daemon {
  private realtimeClient: ConvexClient;
  private httpClient: ConvexHttpClient;
  private authToken: string | null = null;
  private running = false;
  private executing = false;
  private tasksCompletedToday = 0;
  private lastDayReset = new Date().toDateString();
  private callbacks: DaemonCallbacks;
  private dismissedTaskIds = new Set<string>();
  private notifiedInterruptedTaskIds = new Set<string>();

  constructor(callbacks: DaemonCallbacks = {}) {
    const config = getConfig();
    if (!config.convexUrl) {
      throw new Error("Convex URL not configured.");
    }
    this.realtimeClient = new ConvexClient(config.convexUrl);
    this.httpClient = new ConvexHttpClient(config.convexUrl);
    this.callbacks = callbacks;
  }

  async start(): Promise<void> {
    this.running = true;
    this.realtimeClient.setAuth(
      async () => await this.refreshAuth(),
      (isAuthenticated) => {
        if (!isAuthenticated) {
          this.callbacks.onError?.(new Error("Convex authentication failed"));
        }
      }
    );
    await this.recoverStaleTasks();

    this.realtimeClient.onUpdate(
      "tasks:listQueued" as unknown as FunctionReference<"query">,
      { limit: 100 },
      (tasks: QueuedTask[]) => {
        if (!this.running) return;
        this.handleTasksUpdate(tasks);
      }
    );

    // Keep the process alive
    await new Promise<void>((resolve) => {
      const check = setInterval(() => {
        if (!this.running) {
          clearInterval(check);
          resolve();
        }
      }, 1000);
    });
  }

  stop(): void {
    this.running = false;
    this.realtimeClient.close();
  }

  private async handleTasksUpdate(tasks: QueuedTask[]): Promise<void> {
    if (this.executing) return;

    this.resetDailyCounterIfNeeded();
    await this.recoverStaleTasks();
    const config = getConfig();

    if (this.tasksCompletedToday >= config.maxTasksPerDay) {
      this.callbacks.onIdle?.();
      return;
    }

    const eligible = this.filterTasks(tasks, config).filter(
      (task) => !this.dismissedTaskIds.has(task._id)
    );
    if (eligible.length === 0) {
      this.callbacks.onIdle?.();
      return;
    }

    const task = this.pickTask(eligible);
    this.callbacks.onTaskFound?.(task);

    if (!config.autoApprove) {
      const approved = await this.callbacks.onTaskApprovalRequired?.(task);
      if (!approved) {
        this.dismissedTaskIds.add(task._id);
        this.callbacks.onIdle?.();
        return;
      }
    }

    this.executing = true;
    try {
      await this.executeTask(task);
    } catch (err) {
      this.callbacks.onError?.(err as Error);
    } finally {
      this.executing = false;
    }
  }

  private async executeTask(task: QueuedTask): Promise<void> {
    const enabledProviders = getEnabledProviders();

    await this.mutation("tasks:claim", {
      taskId: task._id,
    });
    this.callbacks.onTaskClaimed?.(task);

    await this.mutation("tasks:markRunning", {
      taskId: task._id,
    });
    const stopHeartbeat = this.startHeartbeat(task);

    try {
      if (task.prompt.startsWith("__PROMPTRELAY_FILE_PR__")) {
        const prResult = await this.filePR(task);
        await this.mutation("tasks:complete", {
          taskId: task._id,
          content: prResult,
          executedByProvider: "promptrelay",
          executedByModel: "gh-cli",
          executionDurationMs: 0,
        });
        this.tasksCompletedToday++;
        this.callbacks.onTaskCompleted?.(task, 0);
        return;
      }

      const payload = this.toPayload(task);
      const executors = await this.getExecutionCandidates(task, enabledProviders);
      if (executors.length === 0) {
        throw new Error("No available Claude Code or Codex executor");
      }

      if (!task.acceptedCommentPostedAt) {
        const posted = await this.postTaskAcceptedToIssue(task);
        if (posted) {
          await this.mutation("tasks:markAcceptedCommentPosted", {
            taskId: task._id,
          });
        }
      }

      let result: ExecutionResult | null = null;
      const errors: string[] = [];
      for (const executor of executors) {
        this.callbacks.onTaskRunning?.(task, executor.displayName);
        this.callbacks.onTaskPreview?.(
          task,
          executor.displayName,
          executor.previewCommand?.(payload) ?? "provider-managed execution"
        );

        if (executor instanceof ClaudeCodeExecutor) {
          executor.setStreamCallback((content: string) => {
            this.mutation("tasks:updateStream", {
              taskId: task._id,
              content,
            }).catch(() => {});
          });
        }

        try {
          result = await executor.execute(payload);
          break;
        } catch (err) {
          const message = `${executor.displayName}: ${(err as Error).message}`;
          errors.push(message);
          this.callbacks.onError?.(
            new Error(
              executors.length > 1
                ? `${message}; trying next provider`
                : message
            )
          );
        }
      }

      if (!result) {
        const error = errors.join("\n");
        await this.mutation("tasks:fail", {
          taskId: task._id,
          error,
        });
        await this.postTaskFailedToIssue(task, error);
        throw new Error(errors.join("; "));
      }

      if (task.githubIssueUrl) {
        await this.postResultToIssue(task, result.content);
      }

      await this.mutation("tasks:complete", {
        taskId: task._id,
        content: result.content,
        executedByProvider: result.provider,
        executedByModel: result.model ?? undefined,
        executionDurationMs: result.durationMs,
      });

      this.tasksCompletedToday++;
      this.callbacks.onTaskCompleted?.(task, result.durationMs);
    } finally {
      stopHeartbeat();
    }
  }

  private async getExecutionCandidates(
    task: QueuedTask,
    enabledProviders: string[]
  ): Promise<Executor[]> {
    const providerNames = [
      ...(task.preferredProvider ? [task.preferredProvider] : []),
      ...enabledProviders,
    ].filter((provider, index, all) => all.indexOf(provider) === index);

    const executors: Executor[] = [];
    for (const provider of providerNames) {
      const executor = getExecutor(provider);
      if (executor && (await executor.isAvailable())) {
        executors.push(executor);
      }
    }

    if (executors.length > 0) return executors;

    const fallback = await selectExecutor();
    return fallback ? [fallback] : [];
  }

  private async postTaskAcceptedToIssue(task: QueuedTask): Promise<boolean> {
    if (!task.githubIssueUrl) return false;

    const config = getConfig();
    if (!config.appUrl) return false;
    if (!this.authToken) await this.refreshAuth();

    const res = await fetch(
      `${config.appUrl.replace(/\/$/, "")}/api/github/task-status`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "PromptRelay",
        },
        body: JSON.stringify({
          githubIssueUrl: task.githubIssueUrl,
          event: "accepted",
          title: task.title,
        }),
      }
    );

    if (!res.ok) {
      this.callbacks.onError?.(
        new Error(`Failed to post task acceptance: ${res.status}`)
      );
      return false;
    }
    return true;
  }

  private async postTaskInterruptedToIssue(
    task: Pick<RecoveredTask, "taskId" | "title" | "githubIssueUrl">,
    reason: string
  ): Promise<boolean> {
    return await this.postTaskStatusToIssue(task.githubIssueUrl, {
      event: "interrupted",
      title: task.title,
      reason,
    });
  }

  private async postTaskFailedToIssue(
    task: Pick<QueuedTask, "title" | "githubIssueUrl">,
    reason: string
  ): Promise<boolean> {
    return await this.postTaskStatusToIssue(task.githubIssueUrl, {
      event: "failed",
      title: task.title,
      reason: reason.slice(0, 1500),
    });
  }

  private async postTaskStatusToIssue(
    githubIssueUrl: string | undefined,
    payload: Record<string, unknown>
  ): Promise<boolean> {
    if (!githubIssueUrl) return false;

    const config = getConfig();
    if (!config.appUrl) return false;
    if (!this.authToken) await this.refreshAuth();

    const res = await fetch(
      `${config.appUrl.replace(/\/$/, "")}/api/github/task-status`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.authToken}`,
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "PromptRelay",
        },
        body: JSON.stringify({
          githubIssueUrl,
          ...payload,
        }),
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.callbacks.onError?.(
        new Error(`Failed to post task status: ${res.status}${text ? ` ${text}` : ""}`)
      );
      return false;
    }
    return true;
  }

  private async postResultToIssue(task: QueuedTask, content: string): Promise<void> {
    if (!task.githubIssueUrl) return;

    const config = getConfig();
    if (!config.appUrl) return;
    if (!this.authToken) await this.refreshAuth();

    const res = await fetch(`${config.appUrl.replace(/\/$/, "")}/api/github/result`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.authToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": "PromptRelay",
      },
      body: JSON.stringify({
        githubIssueUrl: task.githubIssueUrl,
        content,
      }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      this.callbacks.onError?.(
        new Error(`Failed to post comment: ${res.status}${text ? ` ${text}` : ""}`)
      );
    }
  }

  private async filePR(task: QueuedTask): Promise<string> {
    const { exec } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const execAsync = promisify(exec);

    if (!task.publicRepoUrl) return "No repo URL — cannot file PR.";

    const match = task.publicRepoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!match) return "Could not parse repo URL.";

    const repoSlug = match[1].replace(/\.git$/, "");
    const localPath = join(homedir(), ".promptrelay", "repos", repoSlug.replace("/", "__"));

    const branchMatch = task.prompt.match(/Branch: (.+)/);
    const branch = branchMatch?.[1]?.trim() ?? "promptrelay/changes";

    const titleMatch = task.prompt.match(/Title: (.+)/);
    const prTitle = titleMatch?.[1]?.trim() ?? task.title;

    try {
      await execAsync(`git checkout '${branch.replace(/'/g, "'\\''")}'`, {
        cwd: localPath, shell: "/bin/zsh", timeout: 30_000,
      });

      const prUrl = await openForkPullRequest({
        workDir: localPath,
        branchName: branch,
        task: this.toPayload(task),
        title: prTitle,
        prompt: "Filed via PromptRelay",
      });

      return prUrl ? `PR created: ${prUrl}` : "No PR created.";
    } catch (err) {
      return `PR filing failed: ${(err as Error).message}\n\nPromptRelay did not push to origin.`;
    }
  }

  private filterTasks(
    tasks: QueuedTask[],
    config: ReturnType<typeof getConfig>
  ): QueuedTask[] {
    return tasks.filter((t) => this.isTrustedTask(t, config.trustedProjects));
  }

  private isTrustedTask(task: QueuedTask, trustedProjects: string[]): boolean {
    if (trustedProjects.includes("*")) return true;
    if (!task.publicRepoUrl) return false;

    const repo = this.repoSlug(task.publicRepoUrl);
    return trustedProjects.some((trusted) => {
      const normalized = trusted.trim();
      return (
        normalized === task.publicRepoUrl ||
        normalized === repo ||
        this.repoSlug(normalized) === repo
      );
    });
  }

  private repoSlug(repoUrl: string): string | null {
    const match = repoUrl.match(/github\.com\/([^/]+\/[^/.]+)(?:\.git)?/);
    return match?.[1] ?? null;
  }

  private toPayload(task: QueuedTask): TaskPayload {
    return {
      id: task._id,
      title: task.title,
      prompt: task.prompt,
      publicRepoUrl: task.publicRepoUrl,
      githubIssueUrl: task.githubIssueUrl,
    };
  }

  private async refreshAuth(): Promise<string> {
    this.authToken = await getConvexAuthToken();
    this.httpClient.setAuth(this.authToken);
    return this.authToken;
  }

  private async mutation(name: string, args: Record<string, unknown>) {
    if (!this.authToken) await this.refreshAuth();
    return await this.httpClient.mutation(
      name as unknown as FunctionReference<"mutation">,
      args
    );
  }

  private async recoverStaleTasks() {
    try {
      const result = await this.mutation("tasks:recoverStaleTasks", {
        limit: 50,
      }) as { tasks?: RecoveredTask[] };
      for (const task of result.tasks ?? []) {
        if (
          task.interruptedCommentPostedAt ||
          this.notifiedInterruptedTaskIds.has(task.taskId)
        ) {
          continue;
        }
        const posted = await this.postTaskInterruptedToIssue(
          task,
          "No heartbeat was received before the claim expired."
        );
        if (posted) {
          this.notifiedInterruptedTaskIds.add(task.taskId);
          await this.mutation("tasks:markInterruptedCommentPosted", {
            taskId: task.taskId,
          });
        }
      }
    } catch (err) {
      this.callbacks.onError?.(err as Error);
    }
  }

  private startHeartbeat(task: QueuedTask): () => void {
    let stopped = false;
    const beat = () => {
      if (stopped) return;
      this.mutation("tasks:heartbeat", { taskId: task._id }).catch(() => {});
    };
    beat();
    const interval = setInterval(beat, 30_000);
    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }

  private pickTask(tasks: QueuedTask[]): QueuedTask {
    const priorityOrder = { high: 0, normal: 1, low: 2 };
    return tasks.sort(
      (a, b) =>
        (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1) -
        (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1)
    )[0];
  }

  private resetDailyCounterIfNeeded(): void {
    const today = new Date().toDateString();
    if (today !== this.lastDayReset) {
      this.tasksCompletedToday = 0;
      this.lastDayReset = today;
    }
  }
}
