"use client";

import { useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { useQuery, useMutation } from "convex/react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SyncUser } from "@/components/sync-user";
import { api } from "../../../../convex/_generated/api";
import { useEffect, useState } from "react";

const allCategories = ["docs", "tests", "bugfix", "review", "refactor", "translation"];

export default function VolunteerSettingsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const githubId = session?.user?.githubId ?? "";

  const settings = useQuery(
    api.volunteerSettings.get,
    githubId ? { githubId } : "skip"
  );
  const upsertSettings = useMutation(api.volunteerSettings.upsert);

  const [maxTasksPerDay, setMaxTasksPerDay] = useState(5);
  const [allowedCategories, setAllowedCategories] = useState<string[]>(allCategories);
  const [trustedProjects, setTrustedProjects] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") signIn("github");
  }, [status]);

  useEffect(() => {
    if (settings) {
      setMaxTasksPerDay(settings.maxTasksPerDay);
      setAllowedCategories(settings.allowedCategories);
      setTrustedProjects(settings.trustedProjects.join(", "));
    }
  }, [settings]);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!githubId) return;

    setSaving(true);
    try {
      await upsertSettings({
        githubId,
        maxTasksPerDay,
        allowedCategories,
        trustedProjects: trustedProjects
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      router.push("/volunteer");
    } finally {
      setSaving(false);
    }
  }

  function toggleCategory(cat: string) {
    setAllowedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat]
    );
  }

  if (!session) return null;

  return (
    <>
      <SyncUser />
      <div className="container mx-auto px-4 py-8 max-w-lg">
        <Card>
          <CardHeader>
            <CardTitle>Volunteer Settings</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <Label htmlFor="maxTasks">Max Tasks Per Day</Label>
                <Input
                  id="maxTasks"
                  type="number"
                  min={1}
                  max={50}
                  value={maxTasksPerDay}
                  onChange={(e) => setMaxTasksPerDay(Number(e.target.value))}
                />
              </div>

              <div>
                <Label>Allowed Categories</Label>
                <div className="flex flex-wrap gap-2 mt-2">
                  {allCategories.map((cat) => (
                    <Button
                      key={cat}
                      type="button"
                      size="sm"
                      variant={
                        allowedCategories.includes(cat) ? "default" : "outline"
                      }
                      onClick={() => toggleCategory(cat)}
                    >
                      {cat}
                    </Button>
                  ))}
                </div>
              </div>

              <div>
                <Label htmlFor="manual">Manual Approval Only</Label>
                <Input
                  id="manual"
                  value="Enabled (locked for MVP)"
                  disabled
                  className="bg-muted"
                />
              </div>

              <div>
                <Label htmlFor="trusted">
                  Trusted Projects (comma-separated, placeholder)
                </Label>
                <Input
                  id="trusted"
                  value={trustedProjects}
                  onChange={(e) => setTrustedProjects(e.target.value)}
                  placeholder="project-a, project-b"
                />
              </div>

              <Button type="submit" disabled={saving} className="w-full">
                {saving ? "Saving..." : "Save Settings"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  );
}
