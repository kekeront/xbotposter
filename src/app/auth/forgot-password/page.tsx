"use client";

import { useActionState } from "react";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { sendPasswordReset, type AuthState } from "../actions";

export default function ForgotPasswordPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    sendPasswordReset,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reset your password</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state?.message && (
            <p className="text-sm text-green-600">{state.message}</p>
          )}

          <p className="text-sm text-muted-foreground">
            Enter your email and we&apos;ll send you a link to set your
            password. This also works if you previously signed in with a magic
            link and have no password yet.
          </p>

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

          <Button type="submit" disabled={pending}>
            {pending ? "Sending..." : "Send reset link"}
          </Button>

          <p className="text-center text-xs text-muted-foreground">
            <Link href="/auth/login" className="text-primary hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}
