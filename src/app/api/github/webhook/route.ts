import { NextRequest, NextResponse } from "next/server";

const COMMAND_PREFIX = "/promptrelay";

interface ParsedCommand {
  action: string;
  category: "docs" | "tests" | "bugfix" | "review" | "refactor" | "translation";
  outputType: "answer" | "review" | "markdown" | "diff" | "pr_draft";
  prompt: string;
}

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

  // Verify webhook signature if secret is configured
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (secret) {
    const signature = req.headers.get("x-hub-signature-256");
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"]
    );
    const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
    const expected = "sha256=" + Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, "0")).join("");
    if (signature !== expected) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }
  }

  const event = req.headers.get("x-github-event");
  if (event !== "issue_comment" && event !== "pull_request_review_comment") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const payload = JSON.parse(body);

  if (payload.action !== "created") {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const comment = payload.comment?.body ?? "";
  if (!comment.startsWith(COMMAND_PREFIX)) {
    return NextResponse.json({ ok: true, skipped: true });
  }

  const repoFullName = payload.repository?.full_name;
  if (!repoFullName) {
    return NextResponse.json({ error: "No repo" }, { status: 400 });
  }

  // Parse the command
  const parsed = parseCommand(comment);
  if (!parsed) {
    await postComment(
      repoFullName,
      payload.issue?.number ?? payload.pull_request?.number,
      formatHelp()
    );
    return NextResponse.json({ ok: true, replied: "help" });
  }

  // Create task in Convex
  try {
    const issueUrl = payload.issue?.html_url ?? payload.pull_request?.html_url;
    const issueTitle = payload.issue?.title ?? payload.pull_request?.title ?? "GitHub task";
    const callerGithubId = String(payload.comment?.user?.id ?? payload.sender?.id);
    const callerGithubUsername = payload.comment?.user?.login ?? payload.sender?.login ?? "unknown";

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
        },
      }),
    });
    if (!mutationRes.ok) {
      const err = await mutationRes.text();
      throw new Error(err);
    }

    // React to the comment to confirm
    await reactToComment(repoFullName, payload.comment?.id);

    await postComment(
      repoFullName,
      payload.issue?.number ?? payload.pull_request?.number,
      `✅ Task queued — a volunteer will pick this up and run it locally.\n\n**${parsed.action}** → \`${parsed.outputType}\``
    );

    return NextResponse.json({ ok: true, taskCreated: true });
  } catch (err) {
    const message = (err as Error).message;

    await postComment(
      repoFullName,
      payload.issue?.number ?? payload.pull_request?.number,
      `Something went wrong: ${message}`
    );

    return NextResponse.json({ error: message }, { status: 400 });
  }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}

function parseCommand(comment: string): ParsedCommand | null {
  const lines = comment.trim().split("\n");
  const firstLine = lines[0].trim();

  // /promptrelay <action> [extra context on same line]
  const parts = firstLine.replace(COMMAND_PREFIX, "").trim().split(/\s+/);
  const action = parts[0]?.toLowerCase();

  if (!action || !ACTION_MAP[action]) {
    return null;
  }

  const { category, outputType } = ACTION_MAP[action];

  // Everything after the command is the prompt context
  const inlineContext = parts.slice(1).join(" ");
  const remainingLines = lines.slice(1).join("\n").trim();
  const prompt = [inlineContext, remainingLines].filter(Boolean).join("\n") ||
    `Perform a ${action} on this issue/PR.`;

  return { action, category, outputType, prompt };
}

function formatHelp(): string {
  return `**PromptRelay** — available commands:

| Command | What it does |
|---------|-------------|
| \`/promptrelay review\` | Code review |
| \`/promptrelay docs\` | Generate documentation |
| \`/promptrelay tests\` | Generate tests |
| \`/promptrelay fix\` | Suggest a bugfix (PR draft) |
| \`/promptrelay refactor\` | Suggest refactoring |
| \`/promptrelay translate\` | Translate content |

Add context after the command:
\`\`\`
/promptrelay review Focus on error handling and race conditions
\`\`\``;
}

async function postComment(repo: string, issueNumber: number, body: string) {
  const token = process.env.GITHUB_APP_TOKEN;
  if (!token) return;

  await fetch(`https://api.github.com/repos/${repo}/issues/${issueNumber}/comments`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
    },
    body: JSON.stringify({ body }),
  });
}

async function reactToComment(repo: string, commentId: number) {
  const token = process.env.GITHUB_APP_TOKEN;
  if (!token) return;

  await fetch(
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
}
