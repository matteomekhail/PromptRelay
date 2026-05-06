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
    const isReviewOnly = ["review", "answer"].includes(task.outputType);

    const workDir = await this.ensureRepo(task.publicRepoUrl);

    const systemPrompt = this.buildSystemPrompt(task);
    const userPrompt = this.buildUserPrompt(task);

    if (isReviewOnly) {
      // Review/answer: just read the code and respond, no branch or PR
      const claudeOutput = await this.runStreaming(userPrompt, systemPrompt, workDir);
      return {
        content: claudeOutput || "No output produced.",
        provider: "claude-code",
        model: "claude-sonnet-4-6",
        durationMs: Date.now() - start,
      };
    }

    // Code change tasks: branch, execute, commit, PR
    const branchName = `promptrelay/${task.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
    await this.ensureBranch(workDir, branchName);

    const claudeOutput = await this.runStreaming(userPrompt, systemPrompt, workDir);
    const diff = await this.captureDiff(workDir);
    await this.commitChanges(workDir, task.title);
    const prUrl = await this.pushAndCreatePR(workDir, branchName, task);
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

  private async commitChanges(workDir: string, title: string): Promise<void> {
    try {
      await execAsync("git add -A", { cwd: workDir, shell: "/bin/zsh" });
      const msg = `promptrelay: ${title}`.replace(/'/g, "");
      await execAsync(`git commit -m '${msg}' --allow-empty`, {
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
      let lastFlush = 0;

      child.stdout.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        const now = Date.now();
        if (this.onStream && now - lastFlush > 500) {
          lastFlush = now;
          this.onStream(output);
        }
      });

      child.stderr.on("data", () => {});

      child.on("close", (code) => {
        if (this.onStream) this.onStream(output);
        if (code === 0 || code === null) {
          resolve(output.trim());
        } else {
          reject(new Error(`Claude Code exited with code ${code}`));
        }
      });

      child.on("error", (err) => {
        reject(new Error(`Claude Code spawn error: ${err.message}`));
      });

      setTimeout(() => {
        child.kill();
        reject(new Error("Claude Code timed out (10 min)"));
      }, 600_000);
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
    const base = `You are working on the open-source project at ${task.publicRepoUrl ?? "this repository"}.`;

    const prompts: Record<string, string> = {
      review: [
        base,
        "You are a senior code reviewer. Read the codebase and provide a thorough code review.",
        "Focus on: bugs, security vulnerabilities, performance issues, code quality, and maintainability.",
        "Structure your review with sections: Summary, Issues Found (critical/warning/info), and Recommendations.",
        "Be specific — reference file names and line numbers. Do NOT modify any files.",
      ].join("\n"),

      docs: [
        base,
        "You are a technical writer. Read the codebase and generate or improve documentation.",
        "Create or update README.md, API docs, inline JSDoc/docstrings, or usage guides as appropriate.",
        "Write clear, concise documentation that helps new contributors get started quickly.",
        "Actually create and write the documentation files. Do NOT just describe what you would write.",
      ].join("\n"),

      tests: [
        base,
        "You are a test engineer. Read the codebase and write comprehensive tests.",
        "Identify untested code paths, edge cases, and critical functionality that needs coverage.",
        "Use the project's existing test framework and conventions. If none exist, pick the standard one for the language.",
        "Actually create the test files and write real, runnable tests. Do NOT just describe them.",
      ].join("\n"),

      bugfix: [
        base,
        "You are a debugging expert. Investigate the reported bug and implement a fix.",
        "First reproduce/understand the issue by reading relevant code. Then implement the minimal fix.",
        "Do NOT refactor unrelated code. Keep the change focused on the bug.",
        "Actually modify the files to fix the bug. Do NOT just describe the fix.",
      ].join("\n"),

      refactor: [
        base,
        "You are a senior engineer performing a code refactoring.",
        "Improve code structure, readability, and maintainability without changing external behavior.",
        "Follow existing project conventions. Keep changes focused and reviewable.",
        "Actually modify the files. Do NOT just describe what you would change.",
      ].join("\n"),

      translation: [
        base,
        "You are a localization specialist. Translate content as specified in the prompt.",
        "Maintain the original formatting, structure, and technical terms where appropriate.",
        "Actually create or modify the translation files. Do NOT just describe what you would translate.",
      ].join("\n"),
    };

    return prompts[task.category] ?? prompts["review"];
  }

  private buildUserPrompt(task: TaskPayload): string {
    return task.prompt;
  }
}
