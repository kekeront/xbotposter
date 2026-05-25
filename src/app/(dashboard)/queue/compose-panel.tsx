"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { ComposeForm } from "./compose-form";

export function ComposePanel() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Button
        variant="outline"
        className="w-full justify-center border-dashed py-5 text-sm text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
      >
        + New draft
      </Button>
    );
  }

  return (
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between border-b px-4 py-2">
        <span className="text-sm font-medium">Compose</span>
        <button
          onClick={() => setOpen(false)}
          className="text-xs text-muted-foreground hover:text-foreground"
        >
          collapse
        </button>
      </div>
      <div className="p-4">
        <ComposeForm />
      </div>
    </div>
  );
}
