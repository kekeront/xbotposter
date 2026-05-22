"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";

type Phase = "idle" | "running" | "done" | "blocked" | "error";

type GenerateResult = {
  generation: { id: string; costUsd: number; model: string };
  posts: Array<{ id: string }>;
};

type BlockedResult = {
  blocked: true;
  category: string;
  reason: string;
  viralAuthor: string;
};

export function ViralActions({
  viralPostId,
  qrtSupported = false,
}: {
  viralPostId: string;
  qrtSupported?: boolean;
}) {
  const router = useRouter();
  const [takePhase, setTakePhase] = useState<Phase>("idle");
  const [qrtPhase, setQrtPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [blockedInfo, setBlockedInfo] = useState<BlockedResult | null>(null);
  const [lastPostId, setLastPostId] = useState<string | null>(null);

  async function run(kind: "take" | "qrt") {
    const setPhase = kind === "take" ? setTakePhase : setQrtPhase;
    setPhase("running");
    setError(null);
    setBlockedInfo(null);
    try {
      const res = await fetch(`/api/discover/${kind}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viralPostId }),
      });
      const data:
        | GenerateResult
        | BlockedResult
        | { error: string; message?: string } = await res.json();
      if (!res.ok) {
        const err = data as { error: string; message?: string };
        throw new Error(err.message ?? err.error ?? `HTTP ${res.status}`);
      }
      if ("blocked" in data && data.blocked) {
        setBlockedInfo(data);
        setPhase("blocked");
        return;
      }
      const result = data as GenerateResult;
      setLastPostId(result.posts[0]?.id ?? null);
      setPhase("done");
      router.refresh();
    } catch (e) {
      setPhase("error");
      setError(e instanceof Error ? e.message : "unknown");
    }
  }

  const busy = takePhase === "running" || qrtPhase === "running";

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error ? (
        <span className="max-w-xs truncate font-mono text-xs text-destructive">
          {error}
        </span>
      ) : null}

      {(takePhase === "blocked" || qrtPhase === "blocked") && blockedInfo ? (
        <span
          className="max-w-md font-mono text-xs text-amber-700 dark:text-amber-400"
          title={blockedInfo.reason}
        >
          🛡 blocked by topic guard: {blockedInfo.category} —{" "}
          {blockedInfo.reason}
        </span>
      ) : null}

      {(takePhase === "done" || qrtPhase === "done") && lastPostId ? (
        <Link
          href="/queue"
          className="font-mono text-xs text-emerald-600 underline dark:text-emerald-500"
        >
          queued — view →
        </Link>
      ) : null}

      <Button
        variant="outline"
        size="sm"
        className="font-mono"
        onClick={() => run("take")}
        disabled={busy}
      >
        {takePhase === "running" ? "taking…" : "take"}
      </Button>

      <Button
        variant="outline"
        size="sm"
        className="font-mono"
        onClick={() => run("qrt")}
        disabled={busy || !qrtSupported}
        title={qrtSupported ? undefined : "qrt lands in slice 4c"}
      >
        {qrtPhase === "running" ? "qrt-ing…" : "QRT"}
      </Button>
    </div>
  );
}
