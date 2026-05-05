"use client";

import { useSession } from "next-auth/react";
import { useMutation } from "convex/react";
import { useEffect, useRef } from "react";
import { api } from "../../convex/_generated/api";

export function useSyncUser() {
  const { data: session } = useSession();
  const upsert = useMutation(api.users.upsertFromGitHub);
  const synced = useRef(false);

  useEffect(() => {
    if (!session?.user?.githubId || synced.current) return;

    synced.current = true;
    upsert({
      githubId: session.user.githubId,
      githubUsername: session.user.githubUsername ?? "",
      name: session.user.name ?? undefined,
      email: session.user.email ?? undefined,
      avatarUrl: session.user.avatarUrl ?? session.user.image ?? undefined,
    }).catch(() => {
      synced.current = false;
    });
  }, [session, upsert]);
}
