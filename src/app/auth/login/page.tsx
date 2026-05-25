"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { login, loginWithMagicLink, type AuthState } from "../actions";

function PasswordForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    login,
    null,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="email">Email</Label>
        <Input
          id="email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="password">Password</Label>
        <Input
          id="password"
          name="password"
          type="password"
          placeholder="••••••••"
          required
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Signing in..." : "Sign in"}
      </Button>

      <p className="text-center text-xs text-muted-foreground">
        <Link
          href="/auth/forgot-password"
          className="text-primary hover:underline"
        >
          Forgot password?
        </Link>
      </p>
    </form>
  );
}

function MagicLinkForm() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    loginWithMagicLink,
    null,
  );

  return (
    <form action={action} className="flex flex-col gap-4">
      {state?.error && (
        <p className="text-sm text-destructive">{state.error}</p>
      )}
      {state?.message && (
        <p className="text-sm text-green-600">{state.message}</p>
      )}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="magic-email">Email</Label>
        <Input
          id="magic-email"
          name="email"
          type="email"
          placeholder="you@example.com"
          required
        />
      </div>

      <Button type="submit" disabled={pending}>
        {pending ? "Sending..." : "Send magic link"}
      </Button>
    </form>
  );
}

export default function LoginPage() {
  const [mode, setMode] = useState<"password" | "magic">("password");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sign in to nfactz</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-4">
          {mode === "password" ? <PasswordForm /> : <MagicLinkForm />}

          <button
            type="button"
            onClick={() =>
              setMode(mode === "password" ? "magic" : "password")
            }
            className="text-xs text-muted-foreground hover:underline"
          >
            {mode === "password"
              ? "Use magic link instead"
              : "Use password instead"}
          </button>

          <p className="text-center text-xs text-muted-foreground">
            Don&apos;t have an account?{" "}
            <Link href="/auth/signup" className="text-primary hover:underline">
              Sign up
            </Link>
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
