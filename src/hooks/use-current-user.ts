"use client";

import { useSession } from "next-auth/react";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";

export function useCurrentUser() {
  const { data: session, status } = useSession();

  const user = useQuery(
    api.users.current,
    status === "authenticated" ? {} : "skip"
  );

  return {
    session,
    user,
    isLoading: status === "loading" || user === undefined,
    isAuthenticated: status === "authenticated",
  };
}
