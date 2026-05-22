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

const secret = process.env.CRON_SECRET;
if (!secret) { console.error("CRON_SECRET not set"); process.exit(1); }

console.log("calling /api/cron/generate...");
const start = Date.now();
const res = await fetch("http://localhost:3000/api/cron/generate", {
  headers: { Authorization: `Bearer ${secret}` },
});
const data = await res.json();
console.log(`status ${res.status} in ${Date.now() - start}ms`);
console.log(JSON.stringify(data, null, 2));
process.exit(0);
