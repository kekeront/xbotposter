"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";
import { disconnectProvider } from "./actions";

export function DisconnectButton({
  connectionId,
  provider,
}: {
  connectionId: string;
  provider: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="destructive"
      size="sm"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await disconnectProvider(connectionId);
        })
      }
    >
      {pending ? "Disconnecting..." : `Disconnect ${provider}`}
    </Button>
  );
}
