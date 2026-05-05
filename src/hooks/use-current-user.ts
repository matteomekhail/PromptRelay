"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useCurrentUser() {
  const { data: session, status } = useSession();
  const githubId = session?.user?.githubId ?? "";

  const user = useQuery(
    api.users.getByGithubId,
    githubId ? { githubId } : "skip"
  );

  return {
    session,
    user,
    isLoading: status === "loading" || user === undefined,
    isAuthenticated: status === "authenticated",
    githubId,
  };
}
