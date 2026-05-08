import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { TaskPayload } from "./types.js";

const execAsync = promisify(exec);

type ExecEnv = NodeJS.ProcessEnv | undefined;

interface ForkPrOptions {
  workDir: string;
  branchName: string;
  task: TaskPayload;
  env?: ExecEnv;
  title?: string;
  prompt?: string;
  headRef?: string;
}

interface RepoRef {
  owner: string;
  name: string;
  fullName: string;
}

export async function commitAndOpenForkPullRequest(
  options: ForkPrOptions
): Promise<string | null> {
  const committed = await commitChanges(
    options.workDir,
    options.title ?? options.task.title,
    options.env
  );
  if (!committed) return null;
  return await openForkPullRequest(options);
}

export async function openForkPullRequest(
  options: ForkPrOptions
): Promise<string | null> {
  const repo = parseRepoUrl(options.task.publicRepoUrl) ?? await repoFromOrigin(options);
  if (!repo) return null;

  const volunteer = await ghLogin(options.env);
  ensureSafePromptRelayBranch(options.branchName);
  if (volunteer === repo.owner) {
    await execGit(
      `git push origin ${shellQuote(options.branchName)}:${shellQuote(options.branchName)} --force-with-lease`,
      options.workDir,
      options.env,
      60_000
    );
    return await createOrFindPullRequest({
      ...options,
      repo,
      volunteer,
      headRef: options.branchName,
    });
  }

  const forkFullName = await ensureFork(repo, volunteer, options.env);
  await ensureForkRemote(options.workDir, forkFullName, options.env);

  await execGit(
    `git push promptrelay-fork ${shellQuote(options.branchName)}:${shellQuote(options.branchName)} --force-with-lease`,
    options.workDir,
    options.env,
    60_000
  );

  return await createOrFindPullRequest({
    ...options,
    repo,
    volunteer,
    headRef: `${volunteer}:${options.branchName}`,
  });
}

async function commitChanges(
  workDir: string,
  title: string,
  env?: ExecEnv
): Promise<boolean> {
  const { stdout: status } = await execGit("git status --porcelain", workDir, env);
  if (!status.trim()) return false;

  await execGit("git add -A", workDir, env);
  const msg = `promptrelay: ${title}`.replace(/\s+/g, " ").trim();
  await execGit(`git commit -m ${shellQuote(msg)}`, workDir, env);
  return true;
}

async function createOrFindPullRequest(
  options: ForkPrOptions & { repo: RepoRef; volunteer: string }
): Promise<string | null> {
  const base = await baseBranch(options.workDir, options.env);
  const title = options.title ?? options.task.title;
  const issueRef = options.task.githubIssueUrl
    ? `\n\nCloses ${options.task.githubIssueUrl}`
    : "";
  const prompt = options.prompt ?? options.task.prompt;
  const quotedPrompt = prompt
    .slice(0, 1000)
    .split(/\r?\n/)
    .map((line) => `> ${line}`)
    .join("\n");
  const body = [
    `## ${title}`,
    "",
    "Executed via [PromptRelay](https://promptrelay.dev) by a volunteer.",
    "",
    "**Prompt:**",
    quotedPrompt,
    issueRef.trim() ? issueRef.trim() : "",
  ]
    .filter(Boolean)
    .join("\n");

  const createCommand = [
    "gh pr create",
    `--repo ${shellQuote(options.repo.fullName)}`,
    `--base ${shellQuote(base)}`,
    `--head ${shellQuote(options.headRef ?? `${options.volunteer}:${options.branchName}`)}`,
    `--title ${shellQuote(title)}`,
    `--body ${shellQuote(body)}`,
  ].join(" ");

  try {
    const { stdout } = await execCommand(createCommand, options.env, options.workDir, 30_000);
    return stdout.trim();
  } catch (err) {
    const message = (err as Error).message;
    if (!/already exists|pull request.*exists|No commits between/i.test(message)) {
      throw err;
    }

    const { stdout } = await execCommand(
      [
        "gh pr list",
        `--repo ${shellQuote(options.repo.fullName)}`,
        `--head ${shellQuote(options.headRef ?? options.branchName)}`,
        "--json url,headRepositoryOwner",
        `--jq ${shellQuote(`.[] | select(.headRepositoryOwner.login == "${options.volunteer}") | .url`)}`,
      ].join(" "),
      options.env,
      options.workDir
    );
    return stdout.trim() || null;
  }
}

async function ensureFork(repo: RepoRef, volunteer: string, env?: ExecEnv): Promise<string> {
  const forkFullName = `${volunteer}/${repo.name}`;
  if (await repoExists(forkFullName, env)) {
    await syncFork(forkFullName, repo.fullName, env);
    return forkFullName;
  }

  await execCommand(
    `gh repo fork ${shellQuote(repo.fullName)} --clone=false --remote=false`,
    env,
    undefined,
    120_000
  );

  for (let i = 0; i < 10; i++) {
    if (await repoExists(forkFullName, env)) return forkFullName;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  throw new Error(`Fork ${forkFullName} was not available after creation.`);
}

async function repoExists(fullName: string, env?: ExecEnv): Promise<boolean> {
  try {
    await execCommand(`gh repo view ${shellQuote(fullName)} --json name`, env);
    return true;
  } catch {
    return false;
  }
}

async function syncFork(
  forkFullName: string,
  sourceFullName: string,
  env?: ExecEnv
): Promise<void> {
  try {
    await execCommand(
      `gh repo sync ${shellQuote(forkFullName)} --source ${shellQuote(sourceFullName)}`,
      env,
      undefined,
      60_000
    );
  } catch {
    // Sync is best-effort. The local clone is still updated from origin before each task.
  }
}

async function ensureForkRemote(
  workDir: string,
  forkFullName: string,
  env?: ExecEnv
): Promise<void> {
  const remoteUrl = `https://github.com/${forkFullName}.git`;
  try {
    await execCommand("gh auth setup-git", env, workDir, 30_000);
  } catch {
    // gh may already be configured or using SSH credentials.
  }

  try {
    await execGit("git remote get-url promptrelay-fork", workDir, env);
    await execGit(`git remote set-url promptrelay-fork ${shellQuote(remoteUrl)}`, workDir, env);
  } catch {
    await execGit(`git remote add promptrelay-fork ${shellQuote(remoteUrl)}`, workDir, env);
  }
}

async function baseBranch(workDir: string, env?: ExecEnv): Promise<string> {
  try {
    const { stdout } = await execGit(
      "git symbolic-ref refs/remotes/origin/HEAD --short",
      workDir,
      env
    );
    return stdout.trim().replace(/^origin\//, "") || "main";
  } catch {
    return "main";
  }
}

async function ghLogin(env?: ExecEnv): Promise<string> {
  const { stdout } = await execCommand("gh api user --jq .login", env);
  const login = stdout.trim();
  if (!login) throw new Error("Could not determine authenticated GitHub user.");
  return login;
}

async function repoFromOrigin(options: ForkPrOptions): Promise<RepoRef | null> {
  try {
    const { stdout } = await execGit("git remote get-url origin", options.workDir, options.env);
    return parseRepoUrl(stdout.trim());
  } catch {
    return null;
  }
}

function parseRepoUrl(repoUrl?: string): RepoRef | null {
  if (!repoUrl) return null;
  const match = repoUrl.match(/github\.com[:/]([^/\s]+)\/([^/\s]+?)(?:\.git)?$/);
  if (!match) return null;

  const owner = match[1];
  const name = match[2].replace(/\.git$/, "");
  return {
    owner,
    name,
    fullName: `${owner}/${name}`,
  };
}

function ensureSafePromptRelayBranch(branchName: string): void {
  if (!branchName.startsWith("promptrelay/")) {
    throw new Error(`Refusing to push non-PromptRelay branch: ${branchName}`);
  }
  if (/^(main|master|develop|trunk)$/i.test(branchName)) {
    throw new Error(`Refusing to push protected branch: ${branchName}`);
  }
}

async function execGit(
  command: string,
  cwd: string,
  env?: ExecEnv,
  timeout?: number
) {
  return await execCommand(command, env, cwd, timeout);
}

async function execCommand(
  command: string,
  env?: ExecEnv,
  cwd?: string,
  timeout?: number
) {
  return await execAsync(command, {
    cwd,
    shell: "/bin/zsh",
    env: {
      ...process.env,
      ...env,
    },
    timeout,
    maxBuffer: 1024 * 1024 * 10,
  });
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}
