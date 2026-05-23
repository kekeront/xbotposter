"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { Post, PostStatus } from "@/db/schema";

export type PostSource =
  | { kind: "ai" | "manual" }
  | {
      kind: "take" | "qrt";
      viralAuthor: string | null;
      viralXTweetId: string | null;
      viralXUrl: string | null;
    };

type Props = {
  post: Post;
  threadCount?: number;
  source?: PostSource | null;
  // Eval score 0-100 from the winner variant (compose) or single gen (cron/take/qrt).
  // Drives the per-row score pill and lets the user prioritize what to ship.
  evalOverall?: number | null;
};

type Phase =
  | "idle"
  | "confirming"
  | "confirming_remove"
  | "scheduling"
  | "posting"
  | "skipping"
  | "retrying"
  | "removing"
  | "done"
  | "error";

function defaultScheduleLocal(): string {
  // Default: tomorrow at 09:00 local time — a typical "wake up and post" slot.
  // If it's currently before 9am today, default to 9am today instead.
  const now = new Date();
  const target = new Date(now);
  if (now.getHours() >= 9) {
    target.setDate(target.getDate() + 1);
  }
  target.setHours(9, 0, 0, 0);
  const yyyy = target.getFullYear();
  const mm = String(target.getMonth() + 1).padStart(2, "0");
  const dd = String(target.getDate()).padStart(2, "0");
  const hh = String(target.getHours()).padStart(2, "0");
  const mn = String(target.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}T${hh}:${mn}`;
}

function fmtScheduled(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const ms = date.getTime() - Date.now();
  if (ms < 0) {
    const ago = Math.floor(-ms / 60000);
    return `${ago}m ago (overdue)`;
  }
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

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

function evalColor(v: number): string {
  if (v >= 85) return "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300";
  if (v >= 70) return "bg-blue-500/15 text-blue-700 dark:text-blue-300";
  if (v >= 50) return "bg-amber-500/15 text-amber-700 dark:text-amber-300";
  return "bg-destructive/15 text-destructive";
}

function sourceModeLabel(kind: PostSource["kind"]): string {
  switch (kind) {
    case "ai":
      return "AI";
    case "manual":
      return "manual";
    case "take":
      return "take";
    case "qrt":
      return "QRT";
  }
}

export function PostRow({ post, threadCount, source, evalOverall }: Props) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [scheduledFor, setScheduledFor] = useState(defaultScheduleLocal());

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
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "skipped" }),
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

  async function doRemove() {
    setPhase("removing");
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

  async function doSchedule() {
    setError(null);
    const iso = new Date(scheduledFor).toISOString();
    try {
      const res = await fetch(`/api/posts/${post.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "approved", scheduledFor: iso }),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setPhase("idle");
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
        {source ? (
          <span className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {sourceModeLabel(source.kind)}
          </span>
        ) : null}
        {evalOverall !== null && evalOverall !== undefined ? (
          <span
            className={`rounded px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${evalColor(evalOverall)}`}
            title="evaluator overall (insight, voice, anti-slop, length, language, faithfulness, stance)"
          >
            eval {evalOverall}
          </span>
        ) : null}
        <Badge variant="outline" className="font-mono">
          {isThread ? `thread${threadCount ? ` · ${threadCount}` : ""}` : "single"}
        </Badge>
        {source && (source.kind === "take" || source.kind === "qrt") ? (
          <span className="font-mono text-muted-foreground">
            on{" "}
            {source.viralXUrl ? (
              <a
                href={source.viralXUrl}
                target="_blank"
                rel="noreferrer"
                className="underline"
              >
                @{source.viralAuthor ?? "?"}
              </a>
            ) : (
              <span>@{source.viralAuthor ?? "?"}</span>
            )}
          </span>
        ) : null}
        <span className="font-mono text-muted-foreground">
          {relativeAge(post.createdAt)} ago
        </span>
        {post.scheduledFor && (post.status === "approved" || post.status === "scheduled") ? (
          <span className="font-mono text-muted-foreground">
            · ships {fmtScheduled(post.scheduledFor)}
          </span>
        ) : null}
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

        <div className="flex items-center gap-2">
          {phase === "error" && error ? (
            <span className="max-w-xs truncate font-mono text-destructive">
              {error}
            </span>
          ) : null}

          {retryable && (phase === "idle" || phase === "error") ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPhase("confirming_remove")}
                className="font-mono text-muted-foreground"
              >
                remove
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={doSkip}
                className="font-mono"
              >
                skip
              </Button>
              <Button size="sm" onClick={doRetry} className="font-mono">
                retry
              </Button>
            </>
          ) : null}

          {actionable && (phase === "idle" || phase === "error") ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setPhase("confirming_remove")}
                className="font-mono text-muted-foreground"
              >
                remove
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={doSkip}
                className="font-mono text-muted-foreground"
              >
                skip
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPhase("scheduling")}
                className="font-mono"
              >
                schedule
              </Button>
              <Button
                size="sm"
                onClick={doPost}
                className="font-mono"
                title={isThread ? "ship the whole thread as chained replies" : "ship now to @kekeront"}
              >
                {isThread ? "ship thread ▸" : "ship now ▸"}
              </Button>
            </>
          ) : null}

          {phase === "scheduling" ? (
            <>
              <input
                type="datetime-local"
                value={scheduledFor}
                onChange={(e) => setScheduledFor(e.target.value)}
                className="rounded-md border bg-background px-2 py-1 font-mono text-xs"
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPhase("idle")}
                className="font-mono"
              >
                cancel
              </Button>
              <Button size="sm" onClick={doSchedule} className="font-mono">
                save schedule
              </Button>
            </>
          ) : null}

          {!actionable && !retryable && (phase === "idle" || phase === "error") ? (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setPhase("confirming_remove")}
              className="font-mono text-muted-foreground"
            >
              remove
            </Button>
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

          {phase === "confirming_remove" ? (
            <>
              <span className="font-mono text-muted-foreground">
                delete permanently?
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPhase("idle")}
                className="font-mono"
              >
                cancel
              </Button>
              <Button
                onClick={doRemove}
                variant="destructive"
                size="sm"
                className="font-mono"
              >
                yes, remove
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
          {phase === "removing" ? (
            <span className="font-mono text-muted-foreground">removing…</span>
          ) : null}
          {phase === "done" ? (
            <span className="font-mono text-emerald-600 dark:text-emerald-500">
              shipped
            </span>
          ) : null}
        </div>
      </footer>
    </article>
  );
}
