import { NextRequest, NextResponse } from "next/server";
import { createConvexAuthToken, type ConvexTokenUser } from "@/lib/convex-auth-token";

export const runtime = "nodejs";

type GitHubUser = {
  id: number;
  login: string;
  name?: string | null;
  email?: string | null;
  avatar_url?: string | null;
};

export async function GET(req: NextRequest) {
  const bearer = getBearerToken(req);
  const user = bearer ? await getGitHubUserFromBearer(bearer) : null;

  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const token = await createConvexAuthToken(user);
  return NextResponse.json({ token, expiresIn: 3600 });
}

function getBearerToken(req: NextRequest) {
  const authorization = req.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ")) return null;
  return authorization.slice("Bearer ".length).trim();
}

async function getGitHubUserFromBearer(token: string): Promise<ConvexTokenUser | null> {
  const res = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "PromptRelay",
    },
  });

  if (!res.ok) return null;

  const user = (await res.json()) as GitHubUser;
  return {
    githubId: String(user.id),
    githubUsername: user.login,
    name: user.name,
    email: user.email,
    avatarUrl: user.avatar_url,
  };
}
