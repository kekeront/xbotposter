"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  initialTweets: string[];
  initialUpdatedAt: string | null;
};

function parseTweets(value: string): string[] {
  return value
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function formatAge(iso: string | null): string {
  if (!iso) return "never";
  const ms = Date.now() - new Date(iso).getTime();
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export function VoiceForm({ initialTweets, initialUpdatedAt }: Props) {
  const [value, setValue] = useState(initialTweets.join("\n\n"));
  const [status, setStatus] = useState<"idle" | "saving" | "saved" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [lastSaved, setLastSaved] = useState<string | null>(initialUpdatedAt);

  const tweets = useMemo(() => parseTweets(value), [value]);

  async function save() {
    setStatus("saving");
    setError(null);
    try {
      const res = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ referenceTweets: tweets }),
      });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      const data: { updatedAt: string } = await res.json();
      setStatus("saved");
      setLastSaved(data.updatedAt);
    } catch (e) {
      setStatus("error");
      setError(e instanceof Error ? e.message : "unknown error");
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <Badge variant="outline" className="font-mono">
          {tweets.length} tweet{tweets.length === 1 ? "" : "s"}
        </Badge>
        <span>last saved {formatAge(lastSaved)}</span>
      </div>

      <Textarea
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          if (status === "saved") setStatus("idle");
        }}
        rows={16}
        className="font-mono text-sm"
        placeholder={`Paste reference tweets here. Separate each tweet with a blank line.

Example:

Most "AI safety" people are just bad at engineering. The model is doing exactly what you trained it to do. Skill issue.

Founders love saying "we're building the future of X". The future of X is fine. You're building a worse version of the present.

The dirty secret of model evals is that the rubric is the model.`}
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          Your own tweets, writers you admire, or both. Used as few-shot
          examples for every draft.
        </p>
        <div className="flex items-center gap-3">
          {status === "saved" ? (
            <span className="font-mono text-xs text-emerald-600 dark:text-emerald-500">
              saved
            </span>
          ) : null}
          {status === "error" && error ? (
            <span className="font-mono text-xs text-destructive">{error}</span>
          ) : null}
          <Button
            onClick={save}
            disabled={status === "saving"}
            className="font-mono"
          >
            {status === "saving" ? "saving…" : "save"}
          </Button>
        </div>
      </div>
    </div>
  );
}
