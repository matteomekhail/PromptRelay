"use client";

import { useParams, useRouter } from "next/navigation";
import { useSession, signIn } from "next-auth/react";
import { useQuery, useMutation } from "convex/react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import { SyncUser } from "@/components/sync-user";
import { useCurrentUser } from "@/hooks/use-current-user";
import { api } from "../../../../convex/_generated/api";
import { Id } from "../../../../convex/_generated/dataModel";
import { useEffect, useState } from "react";

const statusColors: Record<string, string> = {
  queued: "bg-yellow-100 text-yellow-800",
  claimed: "bg-blue-100 text-blue-800",
  running: "bg-purple-100 text-purple-800",
  completed: "bg-green-100 text-green-800",
  rejected: "bg-red-100 text-red-800",
};

export default function TaskDetailPage() {
  const params = useParams();
  const router = useRouter();
  const taskId = params.id as Id<"tasks">;
  const { data: session, status } = useSession();
  const { user } = useCurrentUser();

  const task = useQuery(api.tasks.get, { id: taskId });
  const project = useQuery(
    api.projects.get,
    task ? { id: task.projectId } : "skip"
  );
  const results = useQuery(api.results.listByTask, { taskId });

  const acceptResult = useMutation(api.results.accept);
  const rejectResult = useMutation(api.results.reject);
  const followUp = useMutation(api.tasks.followUp);
  const requestPR = useMutation(api.tasks.requestPR);

  const [copied, setCopied] = useState(false);
  const [replyText, setReplyText] = useState("");
  const [replying, setReplying] = useState(false);
  const [filingPR, setFilingPR] = useState(false);

  useEffect(() => {
    if (status === "unauthenticated") signIn("github");
  }, [status]);

  if (!session || !task) return null;

  const isOwner = user && task.maintainerId === user._id;
  const isCodeOutput = task.outputType === "diff" || task.outputType === "pr_draft";

  async function handleAccept(resultId: Id<"results">) {
    if (!session?.user?.githubId) return;
    await acceptResult({ resultId, githubId: session.user.githubId });
  }

  async function handleReject(resultId: Id<"results">) {
    if (!session?.user?.githubId) return;
    await rejectResult({ resultId, githubId: session.user.githubId });
  }

  async function handleFollowUp() {
    if (!session?.user?.githubId || !replyText.trim()) return;
    setReplying(true);
    try {
      await followUp({
        parentTaskId: taskId,
        githubId: session.user.githubId,
        prompt: replyText.trim(),
      });
      setReplyText("");
    } finally {
      setReplying(false);
    }
  }

  async function handleFilePR() {
    if (!session?.user?.githubId) return;
    setFilingPR(true);
    try {
      await requestPR({
        taskId,
        githubId: session.user.githubId,
      });
    } finally {
      setFilingPR(false);
    }
  }

  function copyContent(content: string) {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <>
      <SyncUser />
      <div className="container mx-auto px-4 py-8 max-w-3xl">
        <div className="mb-6">
          <div className="flex items-start justify-between mb-2">
            <h1 className="text-xl font-semibold">{task.title}</h1>
            <Badge className={statusColors[task.status] ?? ""}>
              {task.status}
            </Badge>
          </div>
          <div className="flex items-center gap-2 text-sm text-muted-foreground flex-wrap">
            <span>{project?.githubRepoFullName ?? project?.name ?? "..."}</span>
            <span>&middot;</span>
            <span>{task.category}</span>
            <span>&middot;</span>
            <span>{task.outputType.replace("_", " ")}</span>
            <span>&middot;</span>
            <span>{task.priority}</span>
            {task.preferredProvider && (
              <>
                <span>&middot;</span>
                <span className="font-mono text-xs">{task.preferredProvider}{task.preferredModel ? ` / ${task.preferredModel}` : ""}</span>
              </>
            )}
          </div>
          {task.executedByProvider && (
            <p className="text-xs text-muted-foreground mt-1">
              Executed by <span className="font-mono">{task.executedByProvider}</span>
              {task.executedByModel && <> / <span className="font-mono">{task.executedByModel}</span></>}
              {task.executionDurationMs && <> in {(task.executionDurationMs / 1000).toFixed(1)}s</>}
            </p>
          )}
        </div>

        <div className="mb-6">
          <h2 className="text-sm font-medium text-muted-foreground mb-2">Prompt</h2>
          <div className="bg-muted/50 rounded-md px-4 py-3 text-sm whitespace-pre-wrap">
            {task.prompt}
          </div>
        </div>

        <Separator className="mb-6" />

        <h2 className="text-sm font-medium text-muted-foreground mb-4">
          {results && results.length > 0 ? `Results (${results.length})` : "Results"}
        </h2>

        {results && results.length > 0 ? (
          <div className="space-y-4">
            {results.map((r) => (
              <Card key={r._id}>
                <CardContent className="pt-4">
                  <div className="flex items-center justify-between mb-3">
                    <Badge
                      variant={
                        r.status === "accepted"
                          ? "default"
                          : r.status === "rejected"
                            ? "destructive"
                            : "secondary"
                      }
                    >
                      {r.status}
                    </Badge>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-xs"
                      onClick={() => copyContent(r.content)}
                    >
                      {copied ? "Copied" : "Copy"}
                    </Button>
                  </div>

                  {isCodeOutput ? (
                    <pre className="text-xs bg-muted border rounded-md p-4 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
                      {r.content}
                    </pre>
                  ) : (
                    <div className="prose prose-sm max-w-none text-sm [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_pre]:bg-muted [&_pre]:border [&_pre]:rounded-md [&_pre]:text-xs [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded">
                      <ReactMarkdown>{r.content}</ReactMarkdown>
                    </div>
                  )}

                  {isOwner && r.status === "submitted" && (
                    <div className="flex gap-2 mt-4 pt-3 border-t">
                      <Button size="sm" onClick={() => handleAccept(r._id)}>
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleReject(r._id)}
                      >
                        Reject
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}

            {/* Follow-up + File PR */}
            {isOwner && task.status === "completed" && (
              <div className="mt-6 pt-4 border-t space-y-4">
                <div>
                  <Textarea
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Send a follow-up: request changes, add more instructions..."
                    rows={2}
                    className="mb-2"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleFollowUp}
                      disabled={replying || !replyText.trim()}
                    >
                      {replying ? "Sending..." : "Send follow-up"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={handleFilePR}
                      disabled={filingPR}
                    >
                      {filingPR ? "Filing..." : "File PR"}
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : task.status === "running" && task.streamingContent ? (
          <Card>
            <CardContent className="pt-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
                <span className="text-xs text-muted-foreground">Streaming live from volunteer...</span>
              </div>
              <div className="prose prose-sm max-w-none text-sm [&_h1]:text-lg [&_h2]:text-base [&_h3]:text-sm [&_pre]:bg-muted [&_pre]:border [&_pre]:rounded-md [&_pre]:text-xs [&_code]:text-xs [&_code]:bg-muted [&_code]:px-1 [&_code]:rounded">
                <ReactMarkdown>{task.streamingContent}</ReactMarkdown>
              </div>
            </CardContent>
          </Card>
        ) : (
          <p className="text-sm text-muted-foreground">
            {task.status === "queued"
              ? "Waiting for a volunteer to pick this up..."
              : task.status === "running"
                ? "A volunteer is executing this task..."
                : "No results yet."}
          </p>
        )}
      </div>
    </>
  );
}
