"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function XConnectButton() {
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setError(null);
    const res = await fetch("/api/auth/x/authorize", { redirect: "manual" });
    if (res.status === 501) {
      const data = await res.json();
      setError(data.error);
      return;
    }
    if (res.type === "opaqueredirect" || (res.status >= 300 && res.status < 400)) {
      window.location.href = "/api/auth/x/authorize";
      return;
    }
    window.location.href = "/api/auth/x/authorize";
  }

  return (
    <div className="flex flex-col gap-2">
      <Button variant="outline" size="sm" onClick={handleConnect}>
        Connect X account
      </Button>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}
