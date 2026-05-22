"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type FetchResult = {
  influencersTracked: number;
  influencersResolved: number;
  tweetsFetched: number;
  tweetsCaptured: number;
  apiCallsApprox: number;
  errors: string[];
  elapsedMs: number;
};

type Phase = "idle" | "confirming" | "fetching" | "done" | "error";

export function FetchButton({ trackedCount }: { trackedCount: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<FetchResult | null>(null);

  async function run() {
    setPhase("fetching");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/discover/fetch", { method: "POST" });
      const data: FetchResult = await res.json();
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      setResult(data);
      setPhase("done");
      router.refresh();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        {phase === "idle" || phase === "done" || phase === "error" ? (
          <Button
            size="sm"
            onClick={() => setPhase("confirming")}
            className="font-mono"
          >
            fetch viral
          </Button>
        ) : null}

        {phase === "confirming" ? (
          <>
            <span className="font-mono text-xs text-muted-foreground">
              fetch from {trackedCount} accounts (~${(trackedCount * 0.02).toFixed(2)} X cost)?
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setPhase("idle")}
              className="font-mono"
            >
              cancel
            </Button>
            <Button size="sm" onClick={run} className="font-mono">
              yes, fetch
            </Button>
          </>
        ) : null}

        {phase === "fetching" ? (
          <span className="font-mono text-xs text-muted-foreground">
            fetching… (10-30s)
          </span>
        ) : null}
      </div>

      {result ? (
        <p className="font-mono text-xs text-muted-foreground">
          captured {result.tweetsCaptured} tweets from{" "}
          {result.influencersResolved}/{result.influencersTracked} accounts ·{" "}
          {result.apiCallsApprox} API calls · {result.elapsedMs}ms
          {result.errors.length > 0
            ? ` · ${result.errors.length} error${result.errors.length === 1 ? "" : "s"}`
            : ""}
        </p>
      ) : null}

      {result && result.errors.length > 0 ? (
        <details className="font-mono text-xs">
          <summary className="cursor-pointer text-destructive">
            {result.errors.length} error{result.errors.length === 1 ? "" : "s"}
          </summary>
          <ul className="mt-2 flex flex-col gap-1 pl-4 text-destructive">
            {result.errors.map((e, i) => (
              <li key={i}>{e}</li>
            ))}
          </ul>
        </details>
      ) : null}

      {phase === "error" && error ? (
        <p className="font-mono text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}
