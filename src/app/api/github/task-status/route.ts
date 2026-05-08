import { NextRequest, NextResponse } from "next/server";
import { verifyConvexAuthToken } from "@/lib/convex-auth-token";
import { createGitHubInstallationTokenForRepo } from "@/lib/github-app";

export const runtime = "nodejs";

type TaskStatusPayload = {
  githubIssueUrl?: string;
  event?: "accepted";
  title?: string;
  provider?: string;
};

export async function POST(req: NextRequest) {
  try {
    const authorization = req.headers.get("authorization");
    const token = authorization?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) {
      return NextResponse.json({ error: "Missing bearer token" }, { status: 401 });
    }

    const verified = await verifyConvexAuthToken(token);
    const payload = (await req.json()) as TaskStatusPayload;
    if (!payload.githubIssueUrl || payload.event !== "accepted") {
      return NextResponse.json({ error: "Invalid task status payload" }, { status: 400 });
    }

    const parsedIssue = parseGitHubIssueUrl(payload.githubIssueUrl);
    if (!parsedIssue) {
      return NextResponse.json({ error: "Invalid GitHub issue URL" }, { status: 400 });
    }

    const installationToken = await createGitHubInstallationTokenForRepo(
      parsedIssue.repo
    );
    const volunteer = getVolunteerUsername(verified.payload);
    const body = formatAcceptedComment({
      provider: payload.provider,
      title: payload.title,
      volunteer,
    });

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

function getVolunteerUsername(payload: Record<string, unknown>) {
  const username = payload.preferred_username ?? payload.nickname;
  return typeof username === "string" && username.trim()
    ? username.trim()
    : "a volunteer";
}

function formatAcceptedComment({
  provider,
  title,
  volunteer,
}: {
  provider?: string;
  title?: string;
  volunteer: string;
}) {
  const runner = volunteer === "a volunteer" ? volunteer : `@${volunteer}`;
  const lines = [
    "Task accepted.",
    "",
    `${runner} is running this locally with the PromptRelay CLI${provider ? ` using ${provider}` : ""}.`,
  ];

  if (title) {
    lines.push("", `Task: ${title}`);
  }

  return lines.join("\n");
}
