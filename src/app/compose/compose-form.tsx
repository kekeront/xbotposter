"use client";

import Link from "next/link";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";

type ContentType = "single" | "thread";

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

export function ComposeForm() {
  const [topic, setTopic] = useState("");
  const [contentType, setContentType] = useState<ContentType>("single");
  const [status, setStatus] = useState<"idle" | "generating" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ComposeResult | null>(null);

  async function submit() {
    if (!topic.trim()) return;
    setStatus("generating");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/compose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, contentType }),
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

  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-3">
            <label
              htmlFor="topic"
              className="text-sm font-medium text-muted-foreground"
            >
              Idea / topic
            </label>
            <div className="ml-auto flex items-center gap-2 font-mono text-xs">
              <button
                type="button"
                onClick={() => setContentType("single")}
                className={`rounded-md px-2 py-1 ${
                  contentType === "single"
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                single
              </button>
              <button
                type="button"
                onClick={() => setContentType("thread")}
                className={`rounded-md px-2 py-1 ${
                  contentType === "thread"
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground"
                }`}
              >
                thread
              </button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <Textarea
            id="topic"
            value={topic}
            onChange={(e) => setTopic(e.target.value)}
            rows={6}
            placeholder={`Paste a thought, a link, a rough idea. Anything.

Example: small models are getting weirdly close to frontier on narrow tasks. write a take.`}
            disabled={status === "generating"}
          />
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              Uses your reference tweets from{" "}
              <Link href="/voice" className="underline">
                Voice
              </Link>{" "}
              as few-shots.
            </p>
            <div className="flex items-center gap-3">
              {status === "error" && error ? (
                <span className="max-w-xs truncate font-mono text-xs text-destructive">
                  {error}
                </span>
              ) : null}
              <Button
                onClick={submit}
                disabled={status === "generating" || !topic.trim()}
                className="font-mono"
              >
                {status === "generating" ? "drafting…" : "draft"}
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
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium">Draft</span>
          <Badge variant="outline" className="font-mono text-xs">
            {result.generation.model}
          </Badge>
          <span className="font-mono text-xs text-muted-foreground">
            {result.generation.tokensIn + result.generation.tokensOut} tokens
            {" · "}${result.generation.costUsd.toFixed(5)}
          </span>
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
