"use client";

import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { useMutation } from "convex/react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncUser } from "@/components/sync-user";
import { useCurrentUser } from "@/hooks/use-current-user";
import { api } from "../../../convex/_generated/api";
import { useEffect } from "react";

export default function OnboardingPage() {
  const { data: session, status } = useSession();
  const { user } = useCurrentUser();
  const router = useRouter();
  const setRole = useMutation(api.users.setRole);

  useEffect(() => {
    if (status === "unauthenticated") {
      signIn("github");
    }
  }, [status]);

  useEffect(() => {
    if (user?.roles?.includes("VOLUNTEER")) {
      router.push("/");
    }
  }, [user, router]);

  if (!session) {
    return null;
  }

  async function handleSelectRole(role: "MAINTAINER" | "VOLUNTEER") {
    if (!session?.user) return;
    await setRole({ role });
    router.push("/");
  }

  return (
    <>
      <SyncUser />
      <div className="container mx-auto px-4 py-16 max-w-lg">
        <h1 className="text-2xl font-bold text-center mb-8">Choose your role</h1>
        <div className="grid gap-4">
          <Card
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => handleSelectRole("MAINTAINER")}
          >
            <CardHeader>
              <CardTitle>Maintainer</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Submit AI tasks for your open-source projects. Receive
                volunteer-generated results like code reviews, docs, tests, and
                diffs.
              </p>
            </CardContent>
          </Card>
          <Card
            className="cursor-pointer hover:border-primary transition-colors"
            onClick={() => handleSelectRole("VOLUNTEER")}
          >
            <CardHeader>
              <CardTitle>Volunteer</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-sm text-muted-foreground">
                Browse queued tasks from open-source maintainers. Run them
                locally with your own AI setup and contribute results back.
              </p>
            </CardContent>
          </Card>
        </div>
        <p className="text-xs text-muted-foreground text-center mt-6">
          You can add both roles to the same account.
        </p>
      </div>
    </>
  );
}
