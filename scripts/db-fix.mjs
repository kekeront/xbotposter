import postgres from "postgres";
import { readFileSync } from "node:fs";

function loadDotenv(path) {
  try {
    const raw = readFileSync(path, "utf-8");
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq < 0) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      if (!process.env[key]) process.env[key] = val;
    }
  } catch {}
}

loadDotenv(".env.local");
loadDotenv(".env");

// Force pooler URL (transaction mode :6543). DIRECT_URL via session pool
// has been hitting Supabase statement_timeout on ALTER.
const url = process.env.DATABASE_URL;
console.log("connecting to:", url?.replace(/:[^:@]+@/, ":***@"));

const sql = postgres(url, { prepare: false, max: 1 });

try {
  await sql`ALTER TABLE posts ADD COLUMN IF NOT EXISTS quote_tweet_id text`;
  console.log("OK: quote_tweet_id added (or already existed)");
  const cols = await sql`SELECT column_name FROM information_schema.columns WHERE table_name = 'posts' AND column_name = 'quote_tweet_id'`;
  console.log("verified present:", cols.length > 0);
} catch (e) {
  console.error("error:", e.message);
}
await sql.end();
