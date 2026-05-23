"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function RowActions({ memoryId }: { memoryId: string }) {
  const router = useRouter();
  const [busy, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  async function call(method: "PATCH" | "DELETE") {
    const confirmed =
      method === "DELETE"
        ? window.confirm("Hard-delete this memory? Use supersede if unsure.")
        : true;
    if (!confirmed) return;
    setErr(null);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/memories/${memoryId}`, { method });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          throw new Error(data.error ?? `HTTP ${res.status}`);
        }
        router.refresh();
      } catch (e) {
        setErr(e instanceof Error ? e.message : "failed");
      }
    });
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <div className="flex gap-1">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 font-mono text-[10px]"
          disabled={busy}
          onClick={() => call("PATCH")}
        >
          supersede
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-6 px-2 font-mono text-[10px] text-destructive"
          disabled={busy}
          onClick={() => call("DELETE")}
        >
          delete
        </Button>
      </div>
      {err ? <span className="text-[10px] text-destructive">{err}</span> : null}
    </div>
  );
}
