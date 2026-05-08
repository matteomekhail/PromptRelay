import { NextRequest, NextResponse } from "next/server";
import { verifyConvexAuthToken } from "@/lib/convex-auth-token";
import { createGitHubInstallationTokenForRepo } from "@/lib/github-app";

export const runtime = "nodejs";

type ResultPayload = {
  githubIssueUrl?: string;
  category?: string;
  content?: string;
};

const MAX_COMMENT_LENGTH = 60_000;

export async function POST(req: NextRequest) {
  try {
    const authorization = req.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
    }

    await verifyConvexAuthToken(token);

    const payload = (await req.json()) as ResultPayload;
    if (!payload.githubIssueUrl || !payload.content || !payload.category) {
      return NextResponse.json({ error: "Invalid result payload" }, { status: 400 });
    }

    const parsedIssue = parseGitHubIssueUrl(payload.githubIssueUrl);
    if (!parsedIssue) {
      return NextResponse.json({ error: "Invalid GitHub issue URL" }, { status: 400 });
    }

    const installationToken = await createGitHubInstallationTokenForRepo(
      parsedIssue.repo
    );
    const body = formatResultComment(payload.category, payload.content);
    const res = await fetch(
      `https://api.github.com/repos/${parsedIssue.repo}/issues/${parsedIssue.issueNumber}/comments`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${installationToken}`,
          Accept: "application/vnd.github+json",
          "User-Agent": "PromptRelay",
        },
        body: JSON.stringify({ body }),
      }
    );

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json(
        { error: `GitHub comment failed: ${res.status}: ${text}` },
        { status: 502 }
      );
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}

function parseGitHubIssueUrl(url: string) {
  const match = url.match(/github\.com\/([^/]+\/[^/]+)\/(?:issues|pull)\/(\d+)/);
  if (!match) return null;
  return {
    repo: match[1].replace(/\.git$/, ""),
    issueNumber: match[2],
  };
}

function formatResultComment(category: string, content: string) {
  const body = `## PromptRelay — ${category}\n\n${content}`;
  if (body.length <= MAX_COMMENT_LENGTH) return body;

  return `${body.slice(0, MAX_COMMENT_LENGTH)}\n\n_Result truncated by PromptRelay._`;
}
