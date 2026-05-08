import { NextRequest, NextResponse } from "next/server";
import { createGitHubInstallationToken } from "@/lib/github-app";

export const runtime = "nodejs";

const DEFAULT_COMMAND_SLUG = "promptrelay";

interface ParsedCommand {
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

type GitHubIssueComment = {
  id?: number;
  body?: string;
  user?: { login?: string; type?: string };
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
      const issueNumber = payload.issue?.number ?? payload.pull_request?.number;
      const issueBody =
        getStringField(payload.issue, "body") ??
        getStringField(payload.pull_request, "body") ??
        "";
      const callerGithubId = String(
        payload.comment?.user?.id ?? payload.sender?.id
      );
      const recentComments = await fetchRecentIssueComments(
        repoFullName,
        issueNumber,
        payload.comment?.id,
        installationToken
      );
      const taskPrompt = formatTaskPrompt({
        repoFullName,
        issueNumber,
        issueTitle,
        issueBody,
        issueUrl,
        maintainerInstruction: parsed.prompt,
        recentComments,
      });

      const convexUrl =
        process.env.PROMPTRELAY_CONVEX_URL ??
        process.env.NEXT_PUBLIC_CONVEX_URL;
      if (!convexUrl) {
        throw new Error("Convex URL is not configured");
      }

      const mutationRes = await fetch(`${convexUrl}/api/mutation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: "github:createTaskFromGitHub",
          args: {
            githubRepoFullName: repoFullName,
            title: issueTitle,
            prompt: taskPrompt,
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
        "Queued. A volunteer CLI will pick this up.",
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

async function fetchRecentIssueComments(
  repo: string,
  issueNumber: number | undefined,
  currentCommentId: number | undefined,
  token: string
): Promise<GitHubIssueComment[]> {
  if (!issueNumber) return [];

  const res = await fetch(
    `https://api.github.com/repos/${repo}/issues/${issueNumber}/comments?per_page=10`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "PromptRelay",
      },
    }
  );
  if (!res.ok) return [];

  const comments = (await res.json()) as GitHubIssueComment[];
  return comments
    .filter((comment) => comment.id !== currentCommentId)
    .filter((comment) => comment.body?.trim())
    .slice(-6);
}

function formatTaskPrompt({
  repoFullName,
  issueNumber,
  issueTitle,
  issueBody,
  issueUrl,
  maintainerInstruction,
  recentComments,
}: {
  repoFullName: string;
  issueNumber?: number;
  issueTitle: string;
  issueBody: string;
  issueUrl?: string;
  maintainerInstruction: string;
  recentComments: GitHubIssueComment[];
}) {
  const body = issueBody.trim() || "No description provided.";
  const discussion = recentComments
    .map((comment) => {
      const author = comment.user?.login ?? "unknown";
      return `- ${author}: ${truncate(cleanPromptRelayNoise(comment.body ?? ""), 900)}`;
    })
    .filter((line) => !line.endsWith(": "))
    .join("\n");

  return [
    "Use the GitHub issue context below to understand references like \"this\", \"it\", or \"the above\".",
    "",
    "Repository:",
    repoFullName,
    "",
    "Issue:",
    `${issueNumber ? `#${issueNumber} ` : ""}${issueTitle}`,
    issueUrl ? `URL: ${issueUrl}` : "",
    "",
    "Issue description:",
    truncate(body, 1800),
    discussion ? "\nRecent discussion:" : "",
    discussion,
    "",
    "Maintainer instruction:",
    maintainerInstruction,
  ]
    .filter(Boolean)
    .join("\n");
}

function cleanPromptRelayNoise(body: string) {
  return body
    .replace(/^Queued\. A volunteer CLI will pick this up\.\s*$/i, "")
    .replace(/^Task queued\. A volunteer can approve and run it locally\.\s*$/i, "")
    .trim();
}

function truncate(value: string, maxLength: number) {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, maxLength).trim()}...`;
}

function getStringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === "string" ? fieldValue : undefined;
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

  const prompt = [command.firstLine, command.remainingLines]
    .filter(Boolean)
    .join("\n")
    .trim();
  if (!prompt) {
    return null;
  }

  return { prompt };
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
  return `**PromptRelay**

Write the task after \`@promptrelay\`:

\`\`\`
@promptrelay add a regression test for the login callback and open a PR
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
