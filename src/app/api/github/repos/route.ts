import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export async function GET() {
  const session = await auth();

  if (!session?.user?.accessToken) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  const res = await fetch(
    "https://api.github.com/user/repos?sort=updated&per_page=50&type=owner",
    {
      headers: {
        Authorization: `Bearer ${session.user.accessToken}`,
        Accept: "application/vnd.github+json",
      },
    }
  );

  if (!res.ok) {
    return NextResponse.json({ error: "GitHub API error" }, { status: res.status });
  }

  const repos = await res.json();

  const simplified = repos.map((r: any) => ({
    id: r.id,
    fullName: r.full_name,
    name: r.name,
    description: r.description,
    url: r.html_url,
    private: r.private,
    language: r.language,
    updatedAt: r.updated_at,
  }));

  return NextResponse.json(simplified);
}
