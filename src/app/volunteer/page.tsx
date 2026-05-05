"use client";

import Link from "next/link";
import { useSession, signIn } from "next-auth/react";
import { useQuery, useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SyncUser } from "@/components/sync-user";
import { useCurrentUser } from "@/hooks/use-current-user";
import { api } from "../../../convex/_generated/api";
import { Id } from "../../../convex/_generated/dataModel";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

const categories = ["all", "docs", "tests", "bugfix", "review", "refactor", "translation"];

export default function VolunteerDashboard() {
  const { data: session, status } = useSession();
  const { user } = useCurrentUser();
  const router = useRouter();
  const githubId = session?.user?.githubId ?? "";

  const queuedTasks = useQuery(api.tasks.listQueued);
  const settings = useQuery(
    api.volunteerSettings.get,
    githubId ? { githubId } : "skip"
  );

  const claimTask = useMutation(api.tasks.claim);

  const [filter, setFilter] = useState("all");
  const [runningTaskId, setRunningTaskId] = useState<string | null>(null);

  useEffect(() => {
    if (status === "unauthenticated") signIn("github");
  }, [status]);

  if (!session || !user) return null;

  const filteredTasks = queuedTasks?.filter(
    (t) => filter === "all" || t.category === filter
  );

  async function handleClaimTask(taskId: Id<"tasks">) {
    if (!githubId) return;

    setRunningTaskId(taskId);
    try {
      await claimTask({ taskId, githubId });
    } catch (err) {
      console.error("Failed to claim task:", err);
    } finally {
      setRunningTaskId(null);
    }
  }

  return (
    <>
      <SyncUser />
      <div className="container mx-auto px-4 py-8 max-w-5xl">
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-2xl font-bold">Volunteer Dashboard</h1>
          <Link href="/volunteer/settings">
            <Button size="sm" variant="outline">Settings</Button>
          </Link>
        </div>

        {settings && (
          <Card className="mb-6">
            <CardContent className="py-3 flex gap-4 text-sm text-muted-foreground">
              <span>Max tasks/day: {settings.maxTasksPerDay}</span>
              <span>Manual approval: always on</span>
              <span>
                Categories:{" "}
                {settings.allowedCategories.length === 6
                  ? "all"
                  : settings.allowedCategories.join(", ")}
              </span>
            </CardContent>
          </Card>
        )}

        <div className="flex items-center gap-3 mb-4">
          <span className="text-sm font-medium">Filter:</span>
          <Select value={filter} onValueChange={(v) => v && setFilter(v)}>
            <SelectTrigger className="w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {filteredTasks && filteredTasks.length > 0 ? (
          <div className="space-y-3">
            {filteredTasks.map((t) => (
              <Card key={t._id}>
                <CardContent className="flex items-center justify-between py-4">
                  <div className="flex-1">
                    <Link
                      href={`/tasks/${t._id}`}
                      className="font-medium hover:underline"
                    >
                      {t.title}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {t.category} &middot; {t.outputType} &middot; {t.priority}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">{t.priority}</Badge>
                    <Button
                      size="sm"
                      disabled={runningTaskId === t._id}
                      onClick={() => handleClaimTask(t._id)}
                    >
                      {runningTaskId === t._id ? "Claiming..." : "Claim"}
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            No queued tasks available. Check back later.
          </p>
        )}
      </div>
    </>
  );
}
