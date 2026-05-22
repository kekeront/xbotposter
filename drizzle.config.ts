import { loadEnvConfig } from "@next/env";
import { defineConfig } from "drizzle-kit";

loadEnvConfig(process.cwd());

const url =
  process.env.DATABASE_DIRECT_URL ??
  process.env.DATABASE_URL ??
  // Placeholder lets `drizzle-kit generate` run without a real DB.
  // `drizzle-kit push` / `migrate` will fail with a connection error
  // until DATABASE_DIRECT_URL is set in .env.local.
  "postgresql://placeholder:placeholder@localhost:5432/placeholder";

export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./src/db/migrations",
  dialect: "postgresql",
  dbCredentials: { url },
  verbose: true,
  strict: true,
});
