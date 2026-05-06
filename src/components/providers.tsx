"use client";

import { ConvexProviderWithAuth, ConvexReactClient } from "convex/react";
import { SessionProvider, useSession } from "next-auth/react";
import { ReactNode } from "react";

const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL!);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <SessionProvider>
      <ConvexAuthProvider>{children}</ConvexAuthProvider>
    </SessionProvider>
  );
}

function ConvexAuthProvider({ children }: { children: ReactNode }) {
  return (
    <ConvexProviderWithAuth client={convex} useAuth={useConvexAuthFromNextAuth}>
      {children}
    </ConvexProviderWithAuth>
  );
}

function useConvexAuthFromNextAuth() {
  const { status } = useSession();

  return {
    isLoading: status === "loading",
    isAuthenticated: status === "authenticated",
    fetchAccessToken: async () => {
      const res = await fetch("/api/convex/token", { cache: "no-store" });
      if (!res.ok) return null;

      const data = (await res.json()) as { token?: string };
      return data.token ?? null;
    },
  };
}
