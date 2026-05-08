import { NextRequest, NextResponse } from "next/server";
import { createGitHubInstallationToken } from "@/lib/github-app";

export const runtime = "nodejs";

const DEFAULT_COMMAND_SLUG = "promptrelay";

interface ParsedCommand {
  action: string;
  category: "docs" | "tests" | "bugfix" | "review" | "refactor" | "translation";
  outputType: "answer" | "review" | "markdown" | "diff" | "pr_draft";
  prompt: string;
}

type GitHubWebhookPayload = {
  action?: string;
  installation?: { id?: number };
  repository?: { full_name?: string };
  sender?: { id?: number; login?: string };
  comment?: {
    id?: number;
    body?: string;
    author_association?: string;
    user?: { id?: number; login?: string };
  };
  issue?: { number?: number; title?: string; html_url?: string };
  pull_request?: { number?: number; title?: string; html_url?: string };
};

const ACTION_MAP: Record<string, { category: ParsedCommand["category"]; outputType: ParsedCommand["outputType"] }> = {
  review: { category: "review", outputType: "review" },
  docs: { category: "docs", outputType: "markdown" },
  tests: { category: "tests", outputType: "diff" },
  fix: { category: "bugfix", outputType: "pr_draft" },
  refactor: { category: "refactor", outputType: "diff" },
  translate: { category: "translation", outputType: "markdown" },
  help: { category: "docs", outputType: "answer" },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.text();

    const secret = process.env.GITHUB_WEBHOOK_SECRET;
    if (!secret) {
      return NextResponse.json(
        { error: "GITHUB_WEBHOOK_SECRET is not configured" },
        { status: 500 }
      );
    }

    const signature = req.headers.get("x-hub-signature-256");
    if (!(await verifyGitHubSignature(body, signature, secret))) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = req.headers.get("x-github-event");
    if (event !== "issue_comment" && event !== "pull_request_review_comment") {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const payload = JSON.parse(body) as GitHubWebhookPayload;

    if (payload.action !== "created") {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const comment = payload.comment?.body ?? "";
    if (!hasCommandTrigger(comment)) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      return NextResponse.json({ error: "No repo" }, { status: 400 });
    }

    const installationId = payload.installation?.id;
    if (!installationId) {
      return NextResponse.json({ error: "No installation" }, { status: 400 });
    }
    const installationToken =
      await createGitHubInstallationToken(installationId);

    const callerGithubUsername =
      payload.comment?.user?.login ?? payload.sender?.login ?? "unknown";
    const authorized = await isAuthorizedMaintainer(
      repoFullName,
      callerGithubUsername,
      installationToken
    );
    if (!authorized) {
      return NextResponse.json({ ok: true, skipped: "unauthorized-commenter" });
    }

    const parsed = parseCommand(comment);
    if (!parsed) {
      await postComment(
        repoFullName,
        payload.issue?.number ?? payload.pull_request?.number,
        formatHelp(),
        installationToken
      );
      return NextResponse.json({ ok: true, replied: "help" });
    }

    try {
      const issueUrl = payload.issue?.html_url ?? payload.pull_request?.html_url;
      const issueTitle =
        payload.issue?.title ?? payload.pull_request?.title ?? "GitHub task";
      const callerGithubId = String(
        payload.comment?.user?.id ?? payload.sender?.id
      );

      const convexUrl = process.env.NEXT_PUBLIC_CONVEX_URL!;
      const mutationRes = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "github:createTaskFromGitHub",
          args: {
            githubRepoFullName: repoFullName,
            title: `[${parsed.action}] ${issueTitle}`,
            prompt: parsed.prompt,
            category: parsed.category,
            outputType: parsed.outputType,
            priority: "normal",
            githubIssueUrl: issueUrl,
            githubCommentId: payload.comment?.id,
            callerGithubId,
            callerGithubUsername,
            webhookSecret: secret,
          },
        }),
      });
      const mutationText = await mutationRes.text();
      if (!mutationRes.ok) {
        throw new Error(mutationText);
      }

      const mutationPayload = JSON.parse(mutationText) as {
        status?: string;
        errorMessage?: string;
      };
      if (mutationPayload.status === "error") {
        throw new Error(
          mutationPayload.errorMessage ?? "Convex task creation failed"
        );
      }

      const reactResult = await reactToComment(
        repoFullName,
        payload.comment?.id,
        installationToken
      );
      const commentResult = await postComment(
        repoFullName,
        payload.issue?.number ?? payload.pull_request?.number,
        `Task queued. A volunteer can approve and run it locally.\n\n**${parsed.action}** -> \`${parsed.outputType}\``,
        installationToken
      );

      return NextResponse.json({
        ok: true,
        taskCreated: true,
        reactResult,
        commentResult,
      });
    } catch (err) {
      const message = (err as Error).message;

      await postComment(
        repoFullName,
        payload.issue?.number ?? payload.pull_request?.number,
        `Something went wrong: ${message}`,
        installationToken
      );

      return NextResponse.json({ error: message }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

async function isAuthorizedMaintainer(
  repo: string,
  username: string,
  token: string
) {
  if (username === "unknown") return false;

  const res = await fetch(
    `https://api.github.com/repos/${repo}/collaborators/${username}/permission`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "PromptRelay",
      },
    }
  );

  if (!res.ok) return false;

  const data = (await res.json()) as { permission?: string };
  return ["admin", "maintain", "write"].includes(data.permission ?? "");
}

async function verifyGitHubSignature(
  body: string,
  signature: string | null,
  secret: string
) {
  if (!signature?.startsWith("sha256=")) return false;

  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

  return signature === expected;
}

function parseCommand(comment: string): ParsedCommand | null {
  const command = extractCommand(comment);
  if (!command) return null;

  const parts = command.firstLine.split(/\s+/).filter(Boolean);
  const action = parts[0]?.toLowerCase();

  if (!action || !ACTION_MAP[action]) {
    return null;
  }

  const { category, outputType } = ACTION_MAP[action];

  // Everything after the command is the prompt context
  const inlineContext = parts.slice(1).join(" ");
  const prompt = [inlineContext, command.remainingLines].filter(Boolean).join("\n") ||
    `Perform a ${action} on this issue/PR.`;

  return { action, category, outputType, prompt };
}

function hasCommandTrigger(comment: string): boolean {
  return extractCommand(comment) !== null;
}

function extractCommand(
  comment: string
): { firstLine: string; remainingLines: string } | null {
  const lines = comment.trim().split(/\r?\n/);
  const firstLine = lines[0]?.trim() ?? "";
  const match = firstLine.match(getCommandTriggerPattern());
  if (!match) return null;

  return {
    firstLine: firstLine.slice(match[0].length).trim(),
    remainingLines: lines.slice(1).join("\n").trim(),
  };
}

function getCommandTriggerPattern(): RegExp {
  const slug = process.env.GITHUB_APP_SLUG?.trim() || DEFAULT_COMMAND_SLUG;
  const slugs = Array.from(new Set([slug, DEFAULT_COMMAND_SLUG]))
    .map(escapeRegExp)
    .join("|");

  return new RegExp(
    `^\\s*(?:\\/(?:${slugs})|@(?:${slugs})(?:\\[bot\\])?)(?:[:,]?\\s+|[:,]?\\s*$)`,
    "i"
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function formatHelp(): string {
  return `**PromptRelay** — available commands:

| Command | What it does |
|---------|-------------|
| \`@promptrelay review\` or \`/promptrelay review\` | Code review |
| \`@promptrelay docs\` or \`/promptrelay docs\` | Generate documentation |
| \`@promptrelay tests\` or \`/promptrelay tests\` | Generate tests |
| \`@promptrelay fix\` or \`/promptrelay fix\` | Suggest a bugfix (PR draft) |
| \`@promptrelay refactor\` or \`/promptrelay refactor\` | Suggest refactoring |
| \`@promptrelay translate\` or \`/promptrelay translate\` | Translate content |

Add context after the command:
\`\`\`
@promptrelay review Focus on error handling and race conditions
\`\`\``;
}

async function postComment(
  repo: string,
  issueNumber: number | undefined,
  body: string,
  token: string
) {
  if (!issueNumber) return { error: "no issue number" };
  const res = await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "PromptRelay",
    },
    body: JSON.stringify({ body }),
  });
  if (!res.ok) {
    const text = await res.text();
    return { error: `${res.status}: ${text}` };
  }
  return { ok: true };
}

async function reactToComment(
  repo: string,
  commentId: number | undefined,
  token: string
) {
  if (!commentId) return { error: "no comment id" };
  const res = await fetch(
    `https://api.github.com/repos/${repo}/issues/comments/${commentId}/reactions`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
      },
      body: JSON.stringify({ content: "eyes" }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    return { error: `${res.status}: ${text}` };
  }
  return { ok: true };
}
