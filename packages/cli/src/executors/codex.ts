import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Executor, TaskPayload, ExecutionResult } from "./types.js";

const execAsync = promisify(exec);

const REPOS_DIR = join(homedir(), ".promptrelay", "repos");

export class CodexExecutor implements Executor {
  name = "codex";
  displayName = "OpenAI Codex CLI";

  async isAvailable(): Promise<boolean> {
    try {
      await execAsync("codex --version", { shell: "/bin/zsh" });
      return true;
    } catch {
      return false;
    }
  }

  async execute(task: TaskPayload): Promise<ExecutionResult> {
    const start = Date.now();

    const workDir = await this.ensureRepo(task.publicRepoUrl);
    const branchName = `promptrelay/${task.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
    await this.ensureBranch(workDir, branchName);

    const prompt = this.buildPrompt(task);
    const escapedPrompt = prompt.replace(/'/g, "'\\''");

    try {
      const { stdout } = await execAsync(
        `codex --quiet --approval-mode full-auto '${escapedPrompt}'`,
        {
          cwd: workDir,
          timeout: 300_000,
          shell: "/bin/zsh",
          env: process.env,
        }
      );

      // Commit whatever codex changed
      await this.commitChanges(workDir, task.title);

      // Push and open PR
      const prUrl = await this.pushAndCreatePR(workDir, branchName, task);

      let content = stdout.trim();
      if (prUrl) {
        content += `\n\n---\n\n**PR opened:** ${prUrl}`;
      }

      return {
        content,
        provider: "codex",
        model: "codex-cli",
        durationMs: Date.now() - start,
      };
    } catch (err) {
      throw new Error(`Codex execution failed: ${(err as Error).message}`);
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
      try {
        await execAsync("git checkout main 2>/dev/null || git checkout master", {
          cwd: localPath, shell: "/bin/zsh", timeout: 30_000,
        });
        await execAsync("git pull --ff-only", {
          cwd: localPath, shell: "/bin/zsh", timeout: 60_000,
        });
      } catch {
        await execAsync("git fetch origin && git reset --hard origin/HEAD", {
          cwd: localPath, shell: "/bin/zsh", timeout: 60_000,
        });
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

  private async commitChanges(workDir: string, title: string): Promise<void> {
    try {
      await execAsync("git add -A", { cwd: workDir, shell: "/bin/zsh" });
      const msg = `promptrelay: ${title}`.replace(/'/g, "");
      await execAsync(`git commit -m '${msg}' --allow-empty`, {
        cwd: workDir, shell: "/bin/zsh",
      });
    } catch {}
  }

  private async pushAndCreatePR(
    workDir: string,
    branchName: string,
    task: TaskPayload
  ): Promise<string | null> {
    try {
      const { stdout: log } = await execAsync(
        `git log origin/HEAD..HEAD --oneline 2>/dev/null || git log --oneline -1`,
        { cwd: workDir, shell: "/bin/zsh" }
      );
      if (!log.trim()) return null;

      await execAsync(`git push origin '${branchName}' --force-with-lease`, {
        cwd: workDir, shell: "/bin/zsh", timeout: 60_000,
      });

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

  private buildPrompt(task: TaskPayload): string {
    const outputInstructions: Record<string, string> = {
      answer: "Respond with a concise answer only.",
      review: "Provide a structured code review.",
      markdown: "Generate markdown documentation.",
      diff: "Output only a unified diff.",
      pr_draft: "Output a complete PR description with summary and diff.",
    };

    return `Task: ${task.title}
Project: ${task.projectName ?? "unknown"}
Category: ${task.category}
Expected output: ${task.outputType} — ${outputInstructions[task.outputType] ?? ""}
${task.publicRepoUrl ? `Repo: ${task.publicRepoUrl}` : ""}

${task.prompt}`;
  }
}
