"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Post, PostStatus } from "@/db/schema";

type Props = {
  post: Post;
  threadCount?: number;
};

type Phase =
  | "idle"
  | "confirming"
  | "posting"
  | "skipping"
  | "retrying"
  | "done"
  | "error";

function statusVariant(s: PostStatus) {
  switch (s) {
    case "draft":
      return "outline" as const;
    case "approved":
    case "scheduled":
      return "secondary" as const;
    case "posted":
      return "default" as const;
    case "failed":
      return "destructive" as const;
    case "skipped":
      return "outline" as const;
  }
}

function relativeAge(d: Date | string): string {
  const ts = typeof d === "string" ? new Date(d).getTime() : d.getTime();
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function xUrl(tweetId: string | null): string | null {
  if (!tweetId) return null;
  return `https://x.com/i/web/status/${tweetId}`;
}

export function PostRow({ post, threadCount }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  const actionable = post.status === "draft" || post.status === "approved";
  const retryable = post.status === "failed";
  const isThread = post.contentType === "thread";

  async function doPost() {
    setPhase("posting");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}/post`, { method: "POST" });
      const data: { error?: string; message?: string } = await res
        .json()
        .catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.message ?? data.error ?? `HTTP ${res.status}`);
      }
      setPhase("done");
      router.refresh();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "unknown");
    }
  }

  async function doSkip() {
    setPhase("skipping");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "unknown");
    }
  }

  async function doRetry() {
    setPhase("retrying");
    setError(null);
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "draft" }),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <article className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <header className="flex flex-wrap items-center gap-2 text-xs">
        <Badge variant={statusVariant(post.status)}>{post.status}</Badge>
        <Badge variant="outline" className="font-mono">
          {isThread ? `thread${threadCount ? ` · ${threadCount}` : ""}` : "single"}
        </Badge>
        <span className="font-mono text-muted-foreground">
          {relativeAge(post.createdAt)} ago
        </span>
        {post.xTweetId ? (
          <a
            href={xUrl(post.xTweetId) ?? "#"}
            target="_blank"
            rel="noreferrer"
            className="ml-auto font-mono text-xs underline text-muted-foreground"
          >
            view on x →
          </a>
        ) : null}
      </header>

      <p className="whitespace-pre-wrap text-sm leading-relaxed">{post.text}</p>

      <footer className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <span className="font-mono text-muted-foreground">
          {post.text.length} chars
          {isThread && threadCount ? ` · ${threadCount} posts total` : ""}
        </span>

        {(actionable || retryable) && (
          <div className="flex items-center gap-2">
            {phase === "error" && error ? (
              <span className="max-w-xs truncate font-mono text-destructive">
                {error}
              </span>
            ) : null}

            {retryable && (phase === "idle" || phase === "error") ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={doSkip}
                  className="font-mono"
                >
                  skip
                </Button>
                <Button
                  size="sm"
                  onClick={doRetry}
                  className="font-mono"
                >
                  retry
                </Button>
              </>
            ) : null}

            {actionable && (phase === "idle" || phase === "error") ? (
              <>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={doSkip}
                  className="font-mono"
                >
                  skip
                </Button>
                <Button
                  size="sm"
                  onClick={() => setPhase("confirming")}
                  className="font-mono"
                >
                  {isThread ? "post thread" : "post"}
                </Button>
              </>
            ) : null}

            {phase === "confirming" ? (
              <>
                <span className="font-mono text-muted-foreground">
                  ship to @kekeront?
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setPhase("idle")}
                  className="font-mono"
                >
                  cancel
                </Button>
                <Button onClick={doPost} size="sm" className="font-mono">
                  yes, ship it
                </Button>
              </>
            ) : null}

            {phase === "posting" ? (
              <span className="font-mono text-muted-foreground">posting…</span>
            ) : null}
            {phase === "skipping" ? (
              <span className="font-mono text-muted-foreground">skipping…</span>
            ) : null}
            {phase === "retrying" ? (
              <span className="font-mono text-muted-foreground">retrying…</span>
            ) : null}
            {phase === "done" ? (
              <span className="font-mono text-emerald-600 dark:text-emerald-500">
                shipped
              </span>
            ) : null}
          </div>
        )}
      </footer>
    </article>
  );
}
