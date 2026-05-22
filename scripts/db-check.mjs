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

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

try {
  const cols = await sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'posts' ORDER BY ordinal_position`;
  console.log("posts columns:");
  for (const c of cols) console.log(" -", c.column_name, ":", c.data_type);
} catch (e) {
  console.error("error:", e.message);
}
await sql.end();
