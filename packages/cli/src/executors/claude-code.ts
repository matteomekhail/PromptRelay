import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Executor, TaskPayload, ExecutionResult } from "./types.js";
import { isUnsafeExecutionAllowed } from "../config.js";

const execAsync = promisify(exec);

const REPOS_DIR = join(homedir(), ".promptrelay", "repos");
const DEFAULT_EXECUTION_TIMEOUT_MS = 300_000;

export class ClaudeCodeExecutor implements Executor {
  name = "claude-code";
  displayName = "Claude Code (Anthropic CLI)";

  private onStream?: (content: string) => void;

  setStreamCallback(cb: (content: string) => void) {
    this.onStream = cb;
  }

  private async findClaudeBin(): Promise<string> {
    const { homedir } = await import("node:os");
    const { join } = await import("node:path");
    const localBin = join(homedir(), ".local", "bin", "claude");
    if (existsSync(localBin)) return localBin;
    try {
      const { stdout } = await execAsync("which claude", { shell: "/bin/zsh" });
      if (stdout.trim()) return stdout.trim();
    } catch {}
    return "claude";
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("claude --version", {
        shell: "/bin/zsh",
        env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:/usr/local/bin:/opt/homebrew/bin:${process.env.PATH}` },
      });
      return true;
    } catch {
      return false;
    }
  }

  previewCommand(): string {
    const unsafe = isUnsafeExecutionAllowed();
    return unsafe
      ? "claude -p <prompt> --output-format text --dangerously-skip-permissions"
      : "claude -p <prompt> --output-format text";
  }

  async execute(task: TaskPayload): Promise<ExecutionResult> {
    const start = Date.now();

    const workDir = await this.ensureRepo(task.publicRepoUrl);

    const systemPrompt = this.buildSystemPrompt(task);
    const userPrompt = this.buildUserPrompt(task);

    const branchName = `promptrelay/${task.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
    await this.ensureBranch(workDir, branchName);

    const claudeOutput = await this.runStreaming(userPrompt, systemPrompt, workDir);
    const diff = await this.captureDiff(workDir);
    const hasChanges = diff !== "(no file changes)";
    const prUrl = hasChanges ? await this.commitAndPushPR(workDir, branchName, task) : null;
    const content = this.formatResult(claudeOutput, diff, prUrl);

    return {
      content,
      provider: "claude-code",
      model: "claude-sonnet-4-6",
      durationMs: Date.now() - start,
    };
  }

  private async ensureBranch(workDir: string, branchName: string): Promise<void> {
    try {
      // Check if branch already exists (follow-up on same task)
      const { stdout } = await execAsync(`git branch --list '${branchName}'`, {
        cwd: workDir, shell: "/bin/zsh",
      });
      if (stdout.trim()) {
        await execAsync(`git checkout '${branchName}'`, { cwd: workDir, shell: "/bin/zsh" });
      } else {
        await execAsync(`git checkout -b '${branchName}'`, { cwd: workDir, shell: "/bin/zsh" });
      }
    } catch {
      // If checkout fails, try creating from main
      try {
        await execAsync(`git checkout main && git checkout -b '${branchName}'`, {
          cwd: workDir, shell: "/bin/zsh",
        });
      } catch {
        // Already on the branch or other issue — continue anyway
      }
    }
  }

  private async captureDiff(workDir: string): Promise<string> {
    try {
      // Staged + unstaged changes
      const { stdout: diffUnstaged } = await execAsync("git diff", {
        cwd: workDir, shell: "/bin/zsh", maxBuffer: 1024 * 1024 * 10,
      });
      const { stdout: diffStaged } = await execAsync("git diff --cached", {
        cwd: workDir, shell: "/bin/zsh", maxBuffer: 1024 * 1024 * 10,
      });
      // Also check for new untracked files
      const { stdout: untracked } = await execAsync("git ls-files --others --exclude-standard", {
        cwd: workDir, shell: "/bin/zsh",
      });

      let result = "";
      if (diffStaged.trim()) result += diffStaged;
      if (diffUnstaged.trim()) result += (result ? "\n" : "") + diffUnstaged;
      if (untracked.trim()) {
        const files = untracked.trim().split("\n");
        for (const f of files) {
          try {
            const { stdout: fileContent } = await execAsync(`cat '${f}'`, {
              cwd: workDir, shell: "/bin/zsh", maxBuffer: 1024 * 1024,
            });
            result += `\n--- /dev/null\n+++ b/${f}\n@@ -0,0 +1,${fileContent.split("\n").length} @@\n`;
            result += fileContent.split("\n").map((l: string) => `+${l}`).join("\n");
          } catch {
            result += `\nNew file: ${f}\n`;
          }
        }
      }
      return result || "(no file changes)";
    } catch {
      return "(could not capture diff)";
    }
  }

  private async commitAndPushPR(
    workDir: string,
    branchName: string,
    task: TaskPayload
  ): Promise<string | null> {
    await this.commitChanges(workDir, task.title);
    return await this.pushAndCreatePR(workDir, branchName, task);
  }

  private async commitChanges(workDir: string, title: string): Promise<void> {
    try {
      const { stdout: status } = await execAsync("git status --porcelain", {
        cwd: workDir,
        shell: "/bin/zsh",
      });
      if (!status.trim()) return;

      await execAsync("git add -A", { cwd: workDir, shell: "/bin/zsh" });
      const msg = `promptrelay: ${title}`.replace(/'/g, "");
      await execAsync(`git commit -m '${msg}'`, {
        cwd: workDir, shell: "/bin/zsh",
      });
    } catch {
      // No changes to commit
    }
  }

  private async pushAndCreatePR(
    workDir: string,
    branchName: string,
    task: TaskPayload
  ): Promise<string | null> {
    try {
      // Check if there are any commits to push
      const { stdout: log } = await execAsync(
        `git log origin/HEAD..HEAD --oneline 2>/dev/null || git log --oneline -1`,
        { cwd: workDir, shell: "/bin/zsh" }
      );
      if (!log.trim()) return null;

      // Push the branch
      await execAsync(`git push origin '${branchName}' --force-with-lease`, {
        cwd: workDir, shell: "/bin/zsh", timeout: 60_000,
      });

      // Build PR body referencing the original issue
      const issueRef = task.githubIssueUrl
        ? `\n\nCloses ${task.githubIssueUrl}`
        : "";
      const body = `## ${task.title}\n\nExecuted via [PromptRelay](https://promptrelay.dev) by a volunteer.\n\n**Prompt:**\n> ${task.prompt.slice(0, 500)}${issueRef}`;
      const escapedBody = body.replace(/'/g, "'\\''");
      const escapedTitle = task.title.replace(/'/g, "'\\''");

      const { stdout: prUrl } = await execAsync(
        `gh pr create --title '${escapedTitle}' --body '${escapedBody}' --head '${branchName}'`,
        { cwd: workDir, shell: "/bin/zsh", timeout: 30_000 }
      );

      return prUrl.trim();
    } catch (err) {
      // If PR already exists or push failed, not fatal
      const msg = (err as Error).message;
      if (msg.includes("already exists")) {
        try {
          const { stdout } = await execAsync(
            `gh pr view '${branchName}' --json url -q .url`,
            { cwd: workDir, shell: "/bin/zsh" }
          );
          return stdout.trim();
        } catch {
          return null;
        }
      }
      return null;
    }
  }

  private formatResult(claudeOutput: string, diff: string, prUrl?: string | null): string {
    let result = "";

    if (claudeOutput.trim()) {
      result += claudeOutput.trim();
    }

    if (diff && diff !== "(no file changes)") {
      result += "\n\n---\n\n### Changes made\n\n```diff\n" + diff + "\n```";
    }

    if (prUrl) {
      result += `\n\n---\n\n**PR opened:** ${prUrl}`;
    }

    return result || "No output or changes produced.";
  }

  private async runStreaming(prompt: string, systemPrompt: string, cwd: string): Promise<string> {
    const claudeBin = await this.findClaudeBin();
    return new Promise((resolve, reject) => {
      const child = spawn(
        claudeBin,
        this.buildClaudeArgs(prompt),
        {
          cwd,
          env: {
            ...process.env,
            HOME: homedir(),
            PATH: `${homedir()}/.local/bin:/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:${process.env.PATH ?? ""}`,
            CLAUDE_CODE_SYSTEM_PROMPT: systemPrompt,
          },
          stdio: ["pipe", "pipe", "pipe"],
        }
      );

      let output = "";
      let stderr = "";
      let lastFlush = 0;
      let settled = false;
      const timeoutMs = Number(
        process.env.PROMPTRELAY_EXECUTION_TIMEOUT_MS ?? DEFAULT_EXECUTION_TIMEOUT_MS
      );

      child.stdin.end();

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const now = Date.now();
        if (this.onStream && now - lastFlush > 500) {
          lastFlush = now;
          this.onStream(output);
        }
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeout = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill();
        reject(new Error(`Claude Code timed out (${Math.round(timeoutMs / 1000)}s)`));
      }, timeoutMs);

      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        if (this.onStream) this.onStream(output);
        if (code === 0 || code === null) {
          resolve(output.trim());
        } else {
          const detail = stderr.trim() ? `: ${stderr.trim().slice(-1000)}` : "";
          reject(new Error(`Claude Code exited with code ${code}${detail}`));
        }
      });

      child.on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`Claude Code spawn error: ${err.message}`));
      });
    });
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

  private buildClaudeArgs(prompt: string) {
    const args = ["-p", prompt, "--output-format", "text"];
    if (isUnsafeExecutionAllowed()) {
      args.push("--dangerously-skip-permissions");
    }
    return args;
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

  private buildSystemPrompt(task: TaskPayload): string {
    return [
      `You are working on the GitHub repository ${task.publicRepoUrl ?? "for this task"}.`,
      "PromptRelay has already cloned or updated the repository and set your current working directory to that clone.",
      "Follow the maintainer's prompt exactly.",
      "If the prompt asks for code, docs, tests, fixes, refactors, or other repository changes, edit the files directly in the working tree.",
      "If the prompt asks for analysis, review, or an answer, provide the response without changing files unless changes are explicitly requested.",
      "Do not create commits, push branches, or open pull requests yourself. PromptRelay will commit, push, and open a PR automatically if you modify files.",
      "Keep unrelated changes out of the worktree and summarize what you did.",
    ].join("\n");
  }

  private buildUserPrompt(task: TaskPayload): string {
    return task.prompt;
  }
}
