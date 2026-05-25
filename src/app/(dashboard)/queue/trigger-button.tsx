"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "running" | "done" | "error";

export function TriggerButton({
  endpoint,
  label,
}: {
  endpoint: string;
  label: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  async function run() {
    setPhase("running");
    setError(null);
    setSummary(null);
    try {
      // Local dev: the spend cap and Bearer check are still on the endpoint,
      // so this proxy fires the same flow Vercel Cron will hit in prod.
      const res = await fetch(`/api/automation/trigger`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint }),
      });
      const data: Record<string, unknown> = await res.json();
      if (!res.ok) {
        throw new Error(
          (data.message as string) ?? (data.error as string) ?? `HTTP ${res.status}`,
        );
      }
      const skipped = data.skipped as string | undefined;
      const generated = data.generated as Record<string, unknown> | undefined;
      const captured = data.tweetsCaptured as number | undefined;
      const processed = data.processed as number | undefined;
      setSummary(
        skipped
          ? `skipped: ${skipped}`
          : generated
            ? `generated: ${generated.viralAuthor ?? "?"} (eval ${generated.evalOverall ?? "?"})`
            : captured !== undefined
              ? `captured ${captured} tweets`
              : processed !== undefined
                ? `processed ${processed} scheduled posts`
                : "ok",
      );
      setPhase("done");
      router.refresh();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        onClick={run}
        disabled={phase === "running"}
        className="font-mono"
      >
        {phase === "running" ? "running…" : label}
      </Button>
      {summary ? (
        <span className="font-mono text-xs text-emerald-700 dark:text-emerald-400">
          {summary}
        </span>
      ) : null}
      {phase === "error" && error ? (
        <span className="max-w-md truncate font-mono text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  );
}
