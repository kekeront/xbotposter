import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url().optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),

  OPENAI_API_KEY: z.string().optional(),
  LLM_CHEAP_MODEL: z.string().default("gpt-5-nano"),
  LLM_MID_MODEL: z.string().default("gpt-5-mini"),
  LLM_WRITER_MODEL: z.string().default("gpt-5-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  X_CONSUMER_KEY: z.string().optional(),
  X_CONSUMER_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),

  CRON_SECRET: z.string().min(8).optional(),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

// Treat empty strings as undefined so blank lines in .env.local don't trip
// `.min(...)` checks on otherwise optional fields.
const normalized: Record<string, string | undefined> = {};
for (const [k, v] of Object.entries(process.env)) {
  normalized[k] = v === "" ? undefined : v;
}

const parsed = schema.safeParse(normalized);

if (!parsed.success) {
  const fieldErrors = parsed.error.flatten().fieldErrors;
  console.error("Invalid environment variables:", fieldErrors);
  const summary = Object.entries(fieldErrors)
    .map(([key, msgs]) => `${key}: ${(msgs ?? []).join(", ")}`)
    .join(" | ");
  throw new Error(
    `Invalid or missing environment variables — ${summary}. Check .env.local against .env.example.`,
  );
}

export const env = parsed.data;

export type Env = typeof env;

export function requireEnv<K extends keyof Env>(key: K): NonNullable<Env[K]> {
  const value = env[key];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `Environment variable ${String(key)} is required for this feature but not set.`,
    );
  }
  return value as NonNullable<Env[K]>;
}
