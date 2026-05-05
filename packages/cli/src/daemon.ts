import { ConvexClient } from "convex/browser";
import { ConvexHttpClient } from "convex/browser";
import { getConfig, getEnabledProviders } from "./config.js";
import { selectExecutor, getExecutor } from "./executors/index.js";
import { ClaudeCodeExecutor } from "./executors/claude-code.js";
import type { TaskPayload } from "./executors/types.js";

interface QueuedTask {
  _id: string;
  title: string;
  prompt: string;
  category: string;
  outputType: string;
  priority: string;
  projectId: string;
  publicRepoUrl?: string;
  githubIssueUrl?: string;
  preferredProvider?: string;
  preferredModel?: string;
  status: string;
}

interface DaemonCallbacks {
  onTaskFound?: (task: QueuedTask) => void;
  onTaskClaimed?: (task: QueuedTask) => void;
  onTaskRunning?: (task: QueuedTask, provider: string) => void;
  onTaskCompleted?: (task: QueuedTask, durationMs: number) => void;
  onTaskError?: (task: QueuedTask, error: Error) => void;
  onIdle?: () => void;
  onError?: (error: Error) => void;
}

export class Daemon {
  private realtimeClient: ConvexClient;
  private httpClient: ConvexHttpClient;
  private running = false;
  private executing = false;
  private tasksCompletedToday = 0;
  private lastDayReset = new Date().toDateString();
  private callbacks: DaemonCallbacks;

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

    this.realtimeClient.onUpdate(
      "tasks:listQueued" as any,
      {},
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
    const config = getConfig();

    if (this.tasksCompletedToday >= config.maxTasksPerDay) {
      this.callbacks.onIdle?.();
      return;
    }

    const eligible = this.filterTasks(tasks, config);
    if (eligible.length === 0) {
      this.callbacks.onIdle?.();
      return;
    }

    const task = this.pickTask(eligible);
    this.callbacks.onTaskFound?.(task);

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
    const config = getConfig();
    const githubId = config.githubId!;
    const enabledProviders = getEnabledProviders();

    await this.httpClient.mutation("tasks:claim" as any, {
      taskId: task._id,
      githubId,
    });
    this.callbacks.onTaskClaimed?.(task);

    await this.httpClient.mutation("tasks:markRunning" as any, {
      taskId: task._id,
      githubId,
    });

    let executor = null;
    if (task.preferredProvider) {
      const preferred = getExecutor(task.preferredProvider);
      if (preferred && (await preferred.isAvailable())) {
        executor = preferred;
      }
    }

    if (!executor) {
      executor = await selectExecutor(
        enabledProviders.filter((p) => p !== "mock")
      );
    }

    if (!executor) {
      executor = await selectExecutor(["mock"]);
    }

    if (!executor) {
      throw new Error("No available executor");
    }

    this.callbacks.onTaskRunning?.(task, executor.displayName);

    if (task.prompt.startsWith("__PROMPTRELAY_FILE_PR__")) {
      const prResult = await this.filePR(task);
      await this.httpClient.mutation("tasks:complete" as any, {
        taskId: task._id,
        githubId,
        content: prResult,
        executedByProvider: "promptrelay",
        executedByModel: "gh-cli",
        executionDurationMs: 0,
      });
      this.tasksCompletedToday++;
      this.callbacks.onTaskCompleted?.(task, 0);
      return;
    }

    if (executor instanceof ClaudeCodeExecutor) {
      executor.setStreamCallback((content: string) => {
        this.httpClient.mutation("tasks:updateStream" as any, {
          taskId: task._id,
          content,
        }).catch(() => {});
      });
    }

    const payload: TaskPayload = {
      id: task._id,
      title: task.title,
      prompt: task.prompt,
      category: task.category,
      outputType: task.outputType,
      publicRepoUrl: task.publicRepoUrl,
      githubIssueUrl: task.githubIssueUrl,
    };

    const result = await executor.execute(payload);

    await this.httpClient.mutation("tasks:complete" as any, {
      taskId: task._id,
      githubId,
      content: result.content,
      executedByProvider: result.provider,
      executedByModel: result.model ?? undefined,
      executionDurationMs: result.durationMs,
    });

    this.tasksCompletedToday++;
    this.callbacks.onTaskCompleted?.(task, result.durationMs);
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
      await execAsync(`git push origin '${branch}'`, {
        cwd: localPath, shell: "/bin/zsh", timeout: 60_000,
      });

      const { stdout } = await execAsync(
        `gh pr create --title '${prTitle.replace(/'/g, "")}' --body 'Filed via PromptRelay' --head '${branch}'`,
        { cwd: localPath, shell: "/bin/zsh", timeout: 30_000 }
      );

      return `PR created: ${stdout.trim()}`;
    } catch (err) {
      return `PR filing failed: ${(err as Error).message}\n\nThe branch \`${branch}\` has been pushed. You can create the PR manually.`;
    }
  }

  private filterTasks(
    tasks: QueuedTask[],
    config: ReturnType<typeof getConfig>
  ): QueuedTask[] {
    return tasks.filter((t) =>
      config.allowedCategories.includes(t.category)
    );
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
