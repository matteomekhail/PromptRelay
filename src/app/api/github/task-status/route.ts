import { NextRequest, NextResponse } from "next/server";
import { verifyConvexAuthToken } from "@/lib/convex-auth-token";
import { createGitHubInstallationTokenForRepo } from "@/lib/github-app";

export const runtime = "nodejs";

type TaskStatusPayload = {
  githubIssueUrl?: string;
  event?: "accepted" | "interrupted" | "failed";
  title?: string;
  reason?: string;
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
    if (
      !payload.githubIssueUrl ||
      !["accepted", "interrupted", "failed"].includes(payload.event ?? "")
    ) {
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
    const body = formatStatusComment(payload, volunteer);

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

function formatStatusComment(payload: TaskStatusPayload, volunteer: string) {
  if (payload.event === "interrupted") {
    const lines = [
      "Run interrupted.",
      "",
      "The volunteer CLI lost contact before completion. PromptRelay returned this task to the queue.",
    ];
    if (payload.reason) lines.push("", `Reason: ${payload.reason}`);
    return lines.join("\n");
  }

  if (payload.event === "failed") {
    const lines = ["Run failed."];
    if (payload.reason) lines.push("", `Reason: ${payload.reason}`);
    return lines.join("\n");
  }

  const runner = volunteer === "a volunteer" ? volunteer : `@${volunteer}`;
  const lines = [
    `Picked up by ${runner}.`,
  ];

  if (payload.title) {
    lines.push("", `Task: ${payload.title}`);
  }

  return lines.join("\n");
}
