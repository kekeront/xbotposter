"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

export function TelegramConnect() {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const botName = process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME;
    if (!botName || !containerRef.current) return;

    // Telegram Login Widget callback
    (window as unknown as Record<string, unknown>).__onTelegramAuth = async (user: Record<string, string>) => {
      setStatus("loading");
      try {
        const res = await fetch("/api/auth/telegram/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(user),
        });
        if (res.ok) {
          setStatus("success");
          window.location.reload();
        } else {
          setStatus("error");
        }
      } catch {
        setStatus("error");
      }
    };

    const script = document.createElement("script");
    script.src = "https://telegram.org/js/telegram-widget.js?22";
    script.setAttribute("data-telegram-login", botName);
    script.setAttribute("data-size", "medium");
    script.setAttribute("data-onauth", "__onTelegramAuth(user)");
    script.setAttribute("data-request-access", "write");
    script.async = true;
    containerRef.current.appendChild(script);

    return () => {
      delete (window as unknown as Record<string, unknown>).__onTelegramAuth;
    };
  }, []);

  if (!process.env.NEXT_PUBLIC_TELEGRAM_BOT_NAME) {
    return (
      <p className="text-xs text-muted-foreground">
        Telegram bot not configured.
      </p>
    );
  }

  if (status === "loading") {
    return <p className="text-sm text-muted-foreground">Verifying...</p>;
  }

  if (status === "error") {
    return <p className="text-sm text-destructive">Verification failed. Try again.</p>;
  }

  return <div ref={containerRef} />;
}
