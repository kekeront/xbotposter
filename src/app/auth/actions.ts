"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ensureProfile } from "@/lib/auth";

export type AuthState = {
  error?: string;
  message?: string;
} | null;

export async function login(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    return { error: error.message };
  }

  redirect("/queue");
}

export async function signup(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const email = formData.get("email") as string;
  const password = formData.get("password") as string;

  if (!email || !password) {
    return { error: "Email and password are required." };
  }

  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) {
    // Supabase returns this when the email is already registered (e.g. via magic link).
    // Don't leak that the email exists — guide them to sign in instead.
    if (
      error.message.toLowerCase().includes("user already registered") ||
      error.message.toLowerCase().includes("already been registered")
    ) {
      return {
        error:
          "An account with this email already exists. Sign in instead, or use 'Forgot password' to set a password.",
      };
    }
    return { error: error.message };
  }

  if (data.user) {
    await ensureProfile(data.user.id, email);
  }

  if (data.user && !data.user.confirmed_at) {
    return { message: "Check your email to confirm your account." };
  }

  redirect("/queue");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/auth/login");
}

export async function updatePassword(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const password = formData.get("password") as string;
  const confirm = formData.get("confirm") as string;

  if (!password || !confirm) {
    return { error: "Both fields are required." };
  }

  if (password.length < 6) {
    return { error: "Password must be at least 6 characters." };
  }

  if (password !== confirm) {
    return { error: "Passwords do not match." };
  }

  const { error } = await supabase.auth.updateUser({ password });
  if (error) {
    return { error: error.message };
  }

  redirect("/queue");
}

export async function sendPasswordReset(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const email = formData.get("email") as string;

  if (!email) {
    return { error: "Email is required." };
  }

  // Works for both password-based accounts AND OTP-only accounts.
  // For OTP-only users this effectively sets their password for the first time.
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback?next=/auth/update-password`,
  });

  if (error) {
    return { error: error.message };
  }

  // Always return a generic message to avoid leaking whether the email exists.
  return {
    message:
      "If an account with that email exists, you will receive a password reset link shortly.",
  };
}

export async function loginWithMagicLink(
  _prev: AuthState,
  formData: FormData,
): Promise<AuthState> {
  const supabase = await createClient();
  const email = formData.get("email") as string;

  if (!email) {
    return { error: "Email is required." };
  }

  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"}/auth/callback`,
    },
  });

  if (error) {
    return { error: error.message };
  }

  return { message: "Check your email for the login link." };
}
