import { exec } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import type { Executor, TaskPayload, ExecutionResult } from "./types.js";
import { isUnsafeExecutionAllowed } from "../config.js";

const execAsync = promisify(exec);

const REPOS_DIR = join(homedir(), ".promptrelay", "repos");

export class CodexExecutor implements Executor {
  name = "codex";
  displayName = "OpenAI Codex CLI";

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

  private async findCodexBin(): Promise<string> {
    const cliDir = process.argv[1] ? dirname(process.argv[1]) : "";
    const localBins = [
      cliDir ? join(cliDir, "codex") : "",
      join(dirname(process.execPath), "codex"),
      join(homedir(), ".local", "bin", "codex"),
    ].filter(Boolean);
    for (const bin of localBins) {
      if (existsSync(bin)) return bin;
    }

    try {
      const { stdout } = await execAsync("which codex", {
        shell: "/bin/zsh",
        env: this.toolEnv(),
      });
      if (stdout.trim()) return stdout.trim();
    } catch {}

    return "codex";
  }

  async isAvailable(): Promise<boolean> {
    try {
      const codexBin = await this.findCodexBin();
      await execAsync(`'${codexBin}' --version`, {
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
      ? "codex --quiet --approval-mode full-auto <prompt>"
      : "codex --quiet <prompt>";
  }

  async execute(task: TaskPayload): Promise<ExecutionResult> {
    const start = Date.now();

    const workDir = await this.ensureRepo(task.publicRepoUrl);
    const branchName = `promptrelay/${task.id.replace(/[^a-zA-Z0-9]/g, "-")}`;
    await this.ensureBranch(workDir, branchName);

    const prompt = this.buildPrompt(task);
    const escapedPrompt = prompt.replace(/'/g, "'\\''");
    const codexBin = await this.findCodexBin();

    try {
      const { stdout } = await execAsync(
        `${this.codexCommand(codexBin)} '${escapedPrompt}'`,
        {
          cwd: workDir,
          timeout: 300_000,
          shell: "/bin/zsh",
          env: this.toolEnv(),
        }
      );

      const hasChanges = await this.hasChanges(workDir);
      const prUrl = hasChanges
        ? await this.commitAndPushPR(workDir, branchName, task)
        : null;

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

  private codexCommand(codexBin: string): string {
    return isUnsafeExecutionAllowed()
      ? `'${codexBin}' --quiet --approval-mode full-auto`
      : `'${codexBin}' --quiet`;
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
      if (!(await this.hasChanges(workDir))) return;

      await execAsync("git add -A", { cwd: workDir, shell: "/bin/zsh" });
      const msg = `promptrelay: ${title}`.replace(/'/g, "");
      await execAsync(`git commit -m '${msg}'`, {
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
    return `You are working on this GitHub repository with PromptRelay.

PromptRelay has already cloned or updated the repository and set your current working directory to that clone.
Follow the maintainer's prompt exactly.
If the prompt asks for code, docs, tests, fixes, refactors, or other repository changes, edit files directly in the working tree.
If the prompt asks for analysis, review, or an answer, respond without changing files unless changes are explicitly requested.
Do not create commits, push branches, or open pull requests yourself. PromptRelay will commit, push, and open a PR automatically if you modify files.

Task: ${task.title}
Project: ${task.projectName ?? "unknown"}
${task.publicRepoUrl ? `Repo: ${task.publicRepoUrl}` : ""}

${task.prompt}`;
  }
}
