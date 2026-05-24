"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "confirming" | "resetting" | "done" | "error";

export function ResetQueueButton({ activeCount }: { activeCount: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  if (activeCount === 0 && phase === "idle") return null;

  async function doReset() {
    setPhase("resetting");
    setError(null);
    try {
      const res = await fetch("/api/queue/reset", { method: "POST" });
      if (!res.ok) {
        const data: { error?: string } = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      setPhase("done");
      router.refresh();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "unknown");
    }
  }

  return (
    <div className="flex items-center gap-2 text-xs">
      {phase === "error" && error ? (
        <span className="max-w-xs truncate font-mono text-destructive">
          {error}
        </span>
      ) : null}

      {phase === "idle" || phase === "error" ? (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setPhase("confirming")}
          className="font-mono text-muted-foreground"
        >
          reset queue
        </Button>
      ) : null}

      {phase === "confirming" ? (
        <>
          <span className="font-mono text-muted-foreground">
            delete {activeCount} active post{activeCount !== 1 ? "s" : ""}?
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
            variant="destructive"
            size="sm"
            onClick={doReset}
            className="font-mono"
          >
            yes, reset
          </Button>
        </>
      ) : null}

      {phase === "resetting" ? (
        <span className="font-mono text-muted-foreground">resetting…</span>
      ) : null}

      {phase === "done" ? (
        <span className="font-mono text-muted-foreground">cleared</span>
      ) : null}
    </div>
  );
}
