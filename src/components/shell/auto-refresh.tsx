"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

/**
 * Drop-in client component that triggers router.refresh() at a fixed interval.
 * Keeps server-rendered pages (e.g. /automation, /traces) feeling live without
 * SSE or WebSocket plumbing. Re-renders only when DB data changes, so the cost
 * is one server roundtrip per tick.
 */
export function AutoRefresh({
  intervalMs = 30_000,
  label = "auto-refresh",
}: {
  intervalMs?: number;
  label?: string;
}) {
  const router = useRouter();
  const [paused, setPaused] = useState(false);
  const [lastTick, setLastTick] = useState<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (paused) return;
    timerRef.current = setInterval(() => {
      setLastTick(Date.now());
      router.refresh();
    }, intervalMs);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [router, intervalMs, paused]);

  const seconds = Math.round(intervalMs / 1000);

  return (
    <button
      type="button"
      onClick={() => setPaused((p) => !p)}
      title={
        paused
          ? "click to resume auto-refresh"
          : `auto-refreshing every ${seconds}s · click to pause`
      }
      className={`flex items-center gap-1.5 rounded-md border bg-background px-2 py-1 font-mono text-xs transition-colors hover:bg-accent ${
        paused ? "text-muted-foreground" : "text-foreground"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          paused
            ? "bg-muted-foreground/50"
            : "animate-pulse bg-emerald-500"
        }`}
      />
      <span>{paused ? "paused" : `${label} ${seconds}s`}</span>
      {!paused && lastTick ? (
        <span className="text-muted-foreground/60">
          · {new Date(lastTick).toLocaleTimeString().slice(0, 8)}
        </span>
      ) : null}
    </button>
  );
}
