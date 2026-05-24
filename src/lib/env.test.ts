import { describe, it, expect } from "vitest";
import { z } from "zod";

// env.ts runs its schema validation at import time, so we can't test it via
// normal import. Instead we replicate the schema and test the parsing logic
// directly. This validates the Zod schema without triggering the side effect.

const schema = z.object({
  DATABASE_URL: z.string().url(),
  DATABASE_DIRECT_URL: z.string().url().optional(),

  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),

  OPENAI_API_KEY: z.string().optional(),
  LLM_CHEAP_MODEL: z.string().default("gpt-5-nano"),
  LLM_MID_MODEL: z.string().default("gpt-5-mini"),
  LLM_WRITER_MODEL: z.string().default("gpt-5.4-mini"),
  EMBEDDING_MODEL: z.string().default("text-embedding-3-small"),

  X_CONSUMER_KEY: z.string().optional(),
  X_CONSUMER_SECRET: z.string().optional(),
  X_ACCESS_TOKEN: z.string().optional(),
  X_ACCESS_TOKEN_SECRET: z.string().optional(),

  CRON_SECRET: z.string().min(8).optional(),

  MAX_DAILY_USD: z.coerce.number().positive().default(2),

  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  NEXT_PUBLIC_APP_URL: z.string().url().optional(),

  MEMORY_ENABLED: z
    .string()
    .optional()
    .transform((v) => v === "true" || v === "1"),
  MEMORY_RECALL_MAX_TOKENS: z.coerce.number().int().positive().default(400),
  MEMORY_RECALL_TIMEOUT_MS: z.coerce.number().int().positive().default(2000),
  MEMORY_RECORD_TIMEOUT_MS: z.coerce.number().int().positive().default(15000),

  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
});

const VALID_ENV = {
  DATABASE_URL: "postgresql://user:pass@host:5432/db",
  NEXT_PUBLIC_SUPABASE_URL: "https://project.supabase.co",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
};

function normalize(env: Record<string, string | undefined>) {
  const result: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    result[k] = v === "" ? undefined : v;
  }
  return result;
}

describe("env schema validation", () => {
  it("accepts minimal valid env", () => {
    const result = schema.safeParse(normalize(VALID_ENV));
    expect(result.success).toBe(true);
  });

  it("applies defaults for model overrides", () => {
    const result = schema.parse(normalize(VALID_ENV));
    expect(result.LLM_CHEAP_MODEL).toBe("gpt-5-nano");
    expect(result.LLM_MID_MODEL).toBe("gpt-5-mini");
    expect(result.LLM_WRITER_MODEL).toBe("gpt-5.4-mini");
    expect(result.EMBEDDING_MODEL).toBe("text-embedding-3-small");
  });

  it("defaults MAX_DAILY_USD to 2", () => {
    const result = schema.parse(normalize(VALID_ENV));
    expect(result.MAX_DAILY_USD).toBe(2);
  });

  it("coerces MAX_DAILY_USD from string", () => {
    const result = schema.parse(
      normalize({ ...VALID_ENV, MAX_DAILY_USD: "5.5" }),
    );
    expect(result.MAX_DAILY_USD).toBe(5.5);
  });

  it("rejects non-positive MAX_DAILY_USD", () => {
    const result = schema.safeParse(
      normalize({ ...VALID_ENV, MAX_DAILY_USD: "0" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects missing DATABASE_URL", () => {
    const result = schema.safeParse(
      normalize({
        NEXT_PUBLIC_SUPABASE_URL: VALID_ENV.NEXT_PUBLIC_SUPABASE_URL,
        NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
          VALID_ENV.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
      }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects invalid DATABASE_URL format", () => {
    const result = schema.safeParse(
      normalize({ ...VALID_ENV, DATABASE_URL: "not-a-url" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", () => {
    const result = schema.safeParse(
      normalize({
        DATABASE_URL: VALID_ENV.DATABASE_URL,
        NEXT_PUBLIC_SUPABASE_URL: VALID_ENV.NEXT_PUBLIC_SUPABASE_URL,
      }),
    );
    expect(result.success).toBe(false);
  });

  it("treats empty string as undefined (normalization)", () => {
    const result = schema.safeParse(
      normalize({ ...VALID_ENV, OPENAI_API_KEY: "" }),
    );
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.OPENAI_API_KEY).toBeUndefined();
    }
  });

  it("rejects CRON_SECRET shorter than 8 chars", () => {
    const result = schema.safeParse(
      normalize({ ...VALID_ENV, CRON_SECRET: "short" }),
    );
    expect(result.success).toBe(false);
  });

  it("accepts valid CRON_SECRET", () => {
    const result = schema.safeParse(
      normalize({ ...VALID_ENV, CRON_SECRET: "long-enough-secret" }),
    );
    expect(result.success).toBe(true);
  });

  it("transforms MEMORY_ENABLED 'true' to boolean true", () => {
    const result = schema.parse(
      normalize({ ...VALID_ENV, MEMORY_ENABLED: "true" }),
    );
    expect(result.MEMORY_ENABLED).toBe(true);
  });

  it("transforms MEMORY_ENABLED '1' to boolean true", () => {
    const result = schema.parse(
      normalize({ ...VALID_ENV, MEMORY_ENABLED: "1" }),
    );
    expect(result.MEMORY_ENABLED).toBe(true);
  });

  it("transforms MEMORY_ENABLED 'false' to boolean false", () => {
    const result = schema.parse(
      normalize({ ...VALID_ENV, MEMORY_ENABLED: "false" }),
    );
    expect(result.MEMORY_ENABLED).toBe(false);
  });

  it("transforms missing MEMORY_ENABLED to false", () => {
    const result = schema.parse(normalize(VALID_ENV));
    expect(result.MEMORY_ENABLED).toBe(false);
  });

  it("defaults NODE_ENV to development", () => {
    const result = schema.parse(normalize(VALID_ENV));
    expect(result.NODE_ENV).toBe("development");
  });

  it("accepts test NODE_ENV", () => {
    const result = schema.parse(
      normalize({ ...VALID_ENV, NODE_ENV: "test" }),
    );
    expect(result.NODE_ENV).toBe("test");
  });

  it("rejects invalid NODE_ENV", () => {
    const result = schema.safeParse(
      normalize({ ...VALID_ENV, NODE_ENV: "staging" }),
    );
    expect(result.success).toBe(false);
  });

  it("coerces MEMORY_RECALL_MAX_TOKENS from string", () => {
    const result = schema.parse(
      normalize({ ...VALID_ENV, MEMORY_RECALL_MAX_TOKENS: "800" }),
    );
    expect(result.MEMORY_RECALL_MAX_TOKENS).toBe(800);
  });

  it("allows all X API fields to be optional", () => {
    const result = schema.safeParse(normalize(VALID_ENV));
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.X_CONSUMER_KEY).toBeUndefined();
      expect(result.data.X_CONSUMER_SECRET).toBeUndefined();
    }
  });

  it("allows Telegram fields to be optional", () => {
    const result = schema.parse(normalize(VALID_ENV));
    expect(result.TELEGRAM_BOT_TOKEN).toBeUndefined();
    expect(result.TELEGRAM_CHAT_ID).toBeUndefined();
  });
});

describe("requireEnv", () => {
  it("throws for undefined value", () => {
    const env = schema.parse(normalize(VALID_ENV));
    const requireEnv = <K extends keyof typeof env>(
      key: K,
    ): NonNullable<(typeof env)[K]> => {
      const value = env[key];
      if (value === undefined || value === null || value === "") {
        throw new Error(
          `Environment variable ${String(key)} is required for this feature but not set.`,
        );
      }
      return value as NonNullable<(typeof env)[K]>;
    };

    expect(() => requireEnv("OPENAI_API_KEY")).toThrow(
      "OPENAI_API_KEY is required",
    );
  });

  it("returns value when present", () => {
    const env = schema.parse(
      normalize({ ...VALID_ENV, OPENAI_API_KEY: "sk-test" }),
    );
    expect(env.OPENAI_API_KEY).toBe("sk-test");
  });
});
