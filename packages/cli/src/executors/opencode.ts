import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Executor, TaskPayload, ExecutionResult } from "./types.js";
import { isUnsafeExecutionAllowed } from "../config.js";
import { commitAndOpenForkPullRequest } from "./github-pr.js";

const execAsync = promisify(exec);

const REPOS_DIR = join(homedir(), ".promptrelay", "repos");
const DEFAULT_IDLE_TIMEOUT_MS = 300_000;
const PROCESS_PROGRESS_POLL_MS = 5_000;
const WORKTREE_PROGRESS_POLL_MS = 15_000;

export class OpenCodeExecutor implements Executor {
  name = "opencode";
  displayName = "OpenCode (sst/opencode)";

  private toolEnv() {
    const cliDir = process.argv[1] ? dirname(process.argv[1]) : "";
    return {
      ...process.env,
      HOME: homedir(),
      PATH: [
        cliDir,
        dirname(process.execPath),
        `${homedir()}/.local/bin`,
        "/usr/local/bin",
        "/opt/homebrew/bin",
        "/usr/bin",
        "/bin",
        process.env.PATH ?? "",
      ].join(":"),
    };
  }

  private async findOpenCodeBin(): Promise<string> {
    const cliDir = process.argv[1] ? dirname(process.argv[1]) : "";
    const localBins = [
      cliDir ? join(cliDir, "opencode") : "",
      join(dirname(process.execPath), "opencode"),
      join(homedir(), ".local", "bin", "opencode"),
    ].filter(Boolean);
    for (const bin of localBins) {
      if (existsSync(bin)) return bin;
    }

    try {
      const { stdout } = await execAsync("which opencode", {
        shell: "/bin/zsh",
        env: this.toolEnv(),
      });
      if (stdout.trim()) return stdout.trim();
    } catch {}

    return "opencode";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const opencodeBin = await this.findOpenCodeBin();
      await execAsync(`'${opencodeBin}' --version`, {
        shell: "/bin/zsh",
        env: this.toolEnv(),
      });
      return true;
    } catch {
      return false;
    }
  }

  previewCommand(): string {
    return isUnsafeExecutionAllowed()
      ? "opencode run --dangerously-skip-permissions <prompt>"
      : "opencode run <prompt>";
  }

  async execute(task: TaskPayload): Promise<ExecutionResult> {
    const start = Date.now();

    const workDir = await this.ensureRepo(task.publicRepoUrl);
    const branchName = `promptrelay/${task.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
    await this.ensureBranch(workDir, branchName);

    const prompt = this.buildPrompt(task);
    const opencodeBin = await this.findOpenCodeBin();

    try {
      const stdout = await this.runOpenCode(opencodeBin, prompt, workDir);

      const hasChanges = await this.hasChanges(workDir);
      const prUrl = hasChanges
        ? await commitAndOpenForkPullRequest({
            workDir,
            branchName,
            task,
            env: this.toolEnv(),
          })
        : null;

      let content = stdout.trim();
      if (prUrl) {
        content += `\n\n---\n\n**PR opened:** ${prUrl}`;
      }
      content = content.trim() || "No output or changes produced.";

      return {
        content,
        provider: "opencode",
        model: "opencode",
        durationMs: Date.now() - start,
      };
    } catch (err) {
      throw new Error(`OpenCode execution failed: ${(err as Error).message}`);
    }
  }

  private async ensureRepo(repoUrl?: string): Promise<string> {
    if (!repoUrl) return process.cwd();

    await mkdir(REPOS_DIR, { recursive: true });

    const match = repoUrl.match(/github\.com\/([^/]+\/[^/]+)/);
    if (!match) return process.cwd();

    const repoSlug = match[1].replace(/\.git$/, "");
    const localPath = join(REPOS_DIR, repoSlug.replace("/", "__"));

    if (existsSync(join(localPath, ".git"))) {
      await this.assertCleanWorktree(localPath);
      try {
        await execAsync("git checkout main 2>/dev/null || git checkout master", {
          cwd: localPath, shell: "/bin/zsh", timeout: 30_000,
        });
        await execAsync("git pull --ff-only", {
          cwd: localPath, shell: "/bin/zsh", timeout: 60_000,
        });
      } catch {
        throw new Error("Could not update repository with a fast-forward pull.");
      }
    } else {
      await execAsync(`git clone '${repoUrl}' '${localPath}'`, {
        shell: "/bin/zsh", timeout: 120_000,
      });
    }

    return localPath;
  }

  private async ensureBranch(workDir: string, branchName: string): Promise<void> {
    try {
      const { stdout } = await execAsync(`git branch --list '${branchName}'`, {
        cwd: workDir, shell: "/bin/zsh",
      });
      if (stdout.trim()) {
        await execAsync(`git checkout '${branchName}'`, { cwd: workDir, shell: "/bin/zsh" });
      } else {
        await execAsync(`git checkout -b '${branchName}'`, { cwd: workDir, shell: "/bin/zsh" });
      }
    } catch {
      try {
        await execAsync(`git checkout main && git checkout -b '${branchName}'`, {
          cwd: workDir, shell: "/bin/zsh",
        });
      } catch {}
    }
  }

  private openCodeArgs(prompt: string): string[] {
    const args = ["run"];
    if (isUnsafeExecutionAllowed()) {
      args.push("--dangerously-skip-permissions");
    }
    args.push(prompt);
    return args;
  }

  private async runOpenCode(
    opencodeBin: string,
    prompt: string,
    cwd: string
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(opencodeBin, this.openCodeArgs(prompt), {
        cwd,
        env: this.toolEnv(),
        stdio: ["ignore", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let lastProcessTime: string | null = null;
      let lastWorktreeStatus: string | null = null;
      let checkingProcess = false;
      let checkingWorktree = false;
      let settled = false;
      const idleTimeoutMs = Number(
        process.env.PROMPTRELAY_IDLE_TIMEOUT_MS ??
          process.env.PROMPTRELAY_EXECUTION_TIMEOUT_MS ??
          DEFAULT_IDLE_TIMEOUT_MS
      );
      let idleTimeout: NodeJS.Timeout;

      const stopChild = () => {
        child.kill("SIGTERM");
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5_000).unref();
      };

      const resetIdleTimer = () => {
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
          if (settled) return;
          settled = true;
          clearInterval(processPoll);
          clearInterval(worktreePoll);
          stopChild();
          reject(
            new Error(
              `OpenCode made no progress for ${Math.round(idleTimeoutMs / 1000)}s`
            )
          );
        }, idleTimeoutMs);
      };

      const worktreePoll = setInterval(() => {
        if (settled || checkingWorktree) return;
        checkingWorktree = true;
        execAsync("git status --porcelain", { cwd, shell: "/bin/zsh" })
          .then(({ stdout: status }) => {
            if (lastWorktreeStatus === null) {
              lastWorktreeStatus = status;
              return;
            }
            if (status !== lastWorktreeStatus) {
              lastWorktreeStatus = status;
              resetIdleTimer();
            }
          })
          .catch(() => {})
          .finally(() => {
            checkingWorktree = false;
          });
      }, WORKTREE_PROGRESS_POLL_MS);
      const processPoll = setInterval(() => {
        if (settled || checkingProcess || !child.pid) return;
        checkingProcess = true;
        execAsync(`ps -o time= -p ${child.pid}`, { shell: "/bin/zsh" })
          .then(({ stdout }) => {
            const processTime = stdout.trim();
            if (!processTime) return;
            if (lastProcessTime === null) {
              lastProcessTime = processTime;
              return;
            }
            if (processTime !== lastProcessTime) {
              lastProcessTime = processTime;
              resetIdleTimer();
            }
          })
          .catch(() => {})
          .finally(() => {
            checkingProcess = false;
          });
      }, PROCESS_PROGRESS_POLL_MS);
      worktreePoll.unref();
      processPoll.unref();
      resetIdleTimer();

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
        resetIdleTimer();
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
        resetIdleTimer();
      });

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimeout);
        clearInterval(processPoll);
        clearInterval(worktreePoll);
        if (code === 0 || code === null) {
          resolve(stdout);
        } else {
          const detail = stderr.trim() ? `: ${stderr.trim().slice(-1000)}` : "";
          reject(new Error(`OpenCode exited with code ${code}${detail}`));
        }
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(idleTimeout);
        clearInterval(processPoll);
        clearInterval(worktreePoll);
        reject(new Error(`OpenCode spawn error: ${err.message}`));
      });
    });
  }

  private async assertCleanWorktree(workDir: string): Promise<void> {
    const { stdout } = await execAsync("git status --porcelain", {
      cwd: workDir,
      shell: "/bin/zsh",
    });
    if (stdout.trim()) {
      throw new Error(
        "Repository worktree is not clean. Commit, stash, or remove local changes before PromptRelay runs."
      );
    }
  }

  private async hasChanges(workDir: string): Promise<boolean> {
    const { stdout } = await execAsync("git status --porcelain", {
      cwd: workDir,
      shell: "/bin/zsh",
    });
    return stdout.trim().length > 0;
  }

  private buildPrompt(task: TaskPayload): string {
    return `You are working on this GitHub repository with PromptRelay.

PromptRelay has already cloned or updated the repository and set your current working directory to that clone.
Follow the maintainer's prompt exactly.
If the prompt asks for code, docs, tests, fixes, refactors, or other repository changes, edit files directly in the working tree.
If the prompt asks for analysis, review, or an answer, respond without changing files unless changes are explicitly requested.
Do not create commits, push branches, or open pull requests yourself. PromptRelay will commit, push to your fork, and open a PR automatically if you modify files.

Task: ${task.title}
Project: ${task.projectName ?? "unknown"}
${task.publicRepoUrl ? `Repo: ${task.publicRepoUrl}` : ""}

${task.prompt}`;
  }
}
