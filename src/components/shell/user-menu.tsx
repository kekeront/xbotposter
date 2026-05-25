"use client";

import { useTransition } from "react";
import Link from "next/link";
import { signOut } from "@/app/auth/actions";

export function UserMenu({ email }: { email: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="mt-auto border-t p-4">
      <div className="flex flex-col gap-2">
        <p className="truncate text-xs text-muted-foreground" title={email}>
          {email}
        </p>
        <div className="flex items-center gap-2">
          <Link
            href="/settings"
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Settings
          </Link>
          <button
            onClick={() => startTransition(() => signOut())}
            disabled={pending}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            {pending ? "..." : "Sign out"}
          </button>
        </div>
      </div>
    </div>
  );
}
