"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

type Props = {
  statuses: Array<"draft" | "skipped" | "failed">;
  label: string;
  count: number;
};

export function ClearQueueButton({ statuses, label, count }: Props) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  if (count === 0) return null;

  async function onClick() {
    const confirmed = window.confirm(
      `Удалить ${count} ${label.toLowerCase()}? Это действие необратимо (треды удалятся вместе с children).`,
    );
    if (!confirmed) return;
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch("/api/posts/clear", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ statuses }),
        });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "unknown error");
      }
    });
  }

  return (
    <div className="flex items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={busy}
        onClick={onClick}
        className="font-mono text-xs"
      >
        {busy ? "очищаю…" : `${label} (${count})`}
      </Button>
      {err ? <span className="text-xs text-destructive">{err}</span> : null}
    </div>
  );
}
