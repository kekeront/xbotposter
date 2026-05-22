"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type ContentType = "single" | "thread";
type Mode = "ai" | "manual";

type ComposeResult = {
  generation: {
    id: string;
    status: "succeeded";
    model: string;
    tokensIn: number;
    tokensOut: number;
    costUsd: number;
  };
  posts: Array<{
    id: string;
    text: string;
    threadPosition: number | null;
  }>;
};

const X_SOFT_LIMIT = 280;

function ToggleButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md px-2 py-1 ${
        active
          ? "bg-foreground text-background"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {children}
    </button>
  );
}

const MODE_STORAGE_KEY = "nfactz.compose.mode";

function readStoredMode(): Mode {
  if (typeof window === "undefined") return "ai";
  const v = window.localStorage.getItem(MODE_STORAGE_KEY);
  return v === "manual" ? "manual" : "ai";
}

export function ComposeForm() {
  const [topic, setTopic] = useState("");
  const [contentType, setContentType] = useState<ContentType>("single");
  const [mode, setMode] = useState<Mode>("ai");

  useEffect(() => {
    // Hydrate from localStorage after mount (avoids SSR mismatch).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(readStoredMode());
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(MODE_STORAGE_KEY, mode);
  }, [mode]);
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeResult | null>(null);

  const isManual = mode === "manual";
  const trimmed = topic.trim();
  const charCount = trimmed.length;
  const overSoftLimit = isManual && contentType === "single" && charCount > X_SOFT_LIMIT;

  async function submit() {
    if (!trimmed) return;
    setStatus("generating");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, contentType, mode }),
      });
      const data: ComposeResult | { error: string; message?: string } =
        await res.json();
      if (!res.ok) {
        const err = data as { error: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      setResult(data as ComposeResult);
      setStatus("done");
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "unknown error");
    }
  }

  const label = isManual ? "Tweet text" : "Idea / topic";
  const placeholder = isManual
    ? contentType === "thread"
      ? `Type the exact tweets, separated by --- on its own line.

Example:

first tweet here
---
second tweet
---
third tweet`
      : `Type the exact tweet you want to ship.

Example: just shipped a thing. small win, but a win.`
    : `Paste a thought, a link, a rough idea. Anything.

Example: small models are getting weirdly close to frontier on narrow tasks. write a take.`;

  const buttonLabel = (() => {
    if (status === "generating") return isManual ? "queueing…" : "drafting…";
    return isManual ? "queue" : "draft";
  })();

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <label
              htmlFor="topic"
              className="text-sm font-medium text-muted-foreground"
            >
              {label}
            </label>
            <div className="ml-auto flex items-center gap-2 font-mono text-xs">
              <ToggleButton
                active={mode === "ai"}
                onClick={() => setMode("ai")}
              >
                ai draft
              </ToggleButton>
              <ToggleButton
                active={mode === "manual"}
                onClick={() => setMode("manual")}
              >
                manual
              </ToggleButton>
              <span className="text-muted-foreground/40">·</span>
              <ToggleButton
                active={contentType === "single"}
                onClick={() => setContentType("single")}
              >
                single
              </ToggleButton>
              <ToggleButton
                active={contentType === "thread"}
                onClick={() => setContentType("thread")}
              >
                thread
              </ToggleButton>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={isManual ? 8 : 6}
            placeholder={placeholder}
            disabled={status === "generating"}
          />
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              {isManual ? (
                <span>
                  Manual mode — text is queued as-is. No AI rewrite, no OpenAI
                  call.
                </span>
              ) : (
                <span>
                  Uses your reference tweets from{" "}
                  <Link href="/voice" className="underline">
                    Voice
                  </Link>{" "}
                  as few-shots.
                </span>
              )}
            </p>
            <div className="flex items-center gap-3">
              {isManual ? (
                <span
                  className={`font-mono text-xs ${
                    overSoftLimit
                      ? "text-destructive"
                      : "text-muted-foreground"
                  }`}
                >
                  {charCount}
                  {contentType === "single" ? `/${X_SOFT_LIMIT}` : ""}
                </span>
              ) : null}
              {status === "error" && error ? (
                <span className="max-w-xs truncate font-mono text-xs text-destructive">
                  {error}
                </span>
              ) : null}
              <Button
                onClick={submit}
                disabled={status === "generating" || !trimmed}
                className="font-mono"
              >
                {buttonLabel}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {result ? <ResultCard result={result} /> : null}
    </div>
  );
}

function ResultCard({ result }: { result: ComposeResult }) {
  const isManual = result.generation.model === "manual";
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium">
            {isManual ? "Queued" : "Draft"}
          </span>
          <Badge variant="outline" className="font-mono text-xs">
            {result.generation.model}
          </Badge>
          {!isManual ? (
            <span className="font-mono text-xs text-muted-foreground">
              {result.generation.tokensIn + result.generation.tokensOut} tokens
              {" · "}${result.generation.costUsd.toFixed(5)}
            </span>
          ) : null}
          <Link
            href="/queue"
            className="ml-auto font-mono text-xs underline text-muted-foreground"
          >
            view in queue →
          </Link>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {result.posts.map((post, i) => (
          <div
            key={post.id}
            className="rounded-lg border bg-card p-4 text-sm leading-relaxed"
          >
            {post.threadPosition !== null ? (
              <div className="mb-2 font-mono text-xs text-muted-foreground">
                {post.threadPosition}/{result.posts.length}
              </div>
            ) : null}
            <p className="whitespace-pre-wrap">{post.text}</p>
            <div className="mt-2 flex items-center gap-2 font-mono text-xs text-muted-foreground">
              <span>{post.text.length} chars</span>
              {i === 0 ? <span>·</span> : null}
              {i === 0 ? <span>status: draft</span> : null}
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
