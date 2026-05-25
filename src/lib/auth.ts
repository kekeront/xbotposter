import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import { eq } from "drizzle-orm";

export type AuthUser = {
  id: string;
  email: string;
};

export async function getUser(): Promise<AuthUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  return { id: user.id, email: user.email ?? "" };
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getUser();
  if (!user) redirect("/auth/login");
  return user;
}

export async function getProfile(userId: string) {
  const [profile] = await db
    .select()
    .from(profiles)
    .where(eq(profiles.id, userId))
    .limit(1);
  return profile ?? null;
}

export async function ensureProfile(userId: string, email: string) {
  const existing = await getProfile(userId);
  if (existing) return existing;

  const [created] = await db
    .insert(profiles)
    .values({ id: userId, email })
    .onConflictDoNothing()
    .returning();
  return created ?? (await getProfile(userId))!;
}
