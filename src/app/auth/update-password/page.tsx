"use client";

import { useActionState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePassword, type AuthState } from "../actions";

export default function UpdatePasswordPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(
    updatePassword,
    null,
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>Set a new password</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          {state?.error && (
            <p className="text-sm text-destructive">{state.error}</p>
          )}
          {state?.message && (
            <p className="text-sm text-green-600">{state.message}</p>
          )}

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="password">New password</Label>
            <Input
              id="password"
              name="password"
              type="password"
              placeholder="••••••••"
              minLength={6}
              required
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="confirm">Confirm password</Label>
            <Input
              id="confirm"
              name="confirm"
              type="password"
              placeholder="••••••••"
              minLength={6}
              required
            />
          </div>

          <Button type="submit" disabled={pending}>
            {pending ? "Updating..." : "Set password"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
