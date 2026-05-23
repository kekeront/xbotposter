// Seed the memory layer with a Telegram channel dump.
//
// Usage:
//   npm run seed:tg path/to/posts.txt
//
// Input file format: one post per paragraph, paragraphs separated by a
// blank line. Skips empty paragraphs and anything shorter than 10 chars
// (URLs, single emojis, etc). Caps at 50 posts per call (server limit).
//
// Cost: ~$0.0005 per post, so 50 posts ≈ $0.025.

import { readFileSync } from "node:fs";

function loadEnv(p) {
  try {
    for (const l of readFileSync(p, "utf-8").split(/\r?\n/)) {
      if (!l || l.startsWith("#")) continue;
      const e = l.indexOf("=");
      if (e < 0) continue;
      const k = l.slice(0, e).trim();
      let v = l.slice(e + 1).trim();
      if (v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
      if (!process.env[k]) process.env[k] = v;
    }
  } catch {}
}
loadEnv(".env.local");
loadEnv(".env");

const path = process.argv[2];
if (!path) {
  console.error("usage: npm run seed:tg <path-to-dump.txt>");
  process.exit(1);
}

const BASE = process.env.LOCAL_BASE_URL ?? "http://localhost:3000";
const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET missing — required for seed endpoint auth");
  process.exit(1);
}

const raw = readFileSync(path, "utf-8");
const posts = raw
  .split(/\n\s*\n/)
  .map((s) => s.trim())
  .filter((s) => s.length >= 10)
  .slice(0, 50)
  .map((text) => ({ text }));

if (posts.length === 0) {
  console.error("no posts parsed from", path);
  process.exit(1);
}

console.log(`seeding ${posts.length} post(s) to ${BASE}/api/memories/seed`);

const res = await fetch(`${BASE}/api/memories/seed`, {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: `Bearer ${secret}`,
  },
  body: JSON.stringify({ posts }),
});

const data = await res.json().catch(() => ({}));
if (!res.ok) {
  console.error(`HTTP ${res.status}:`, JSON.stringify(data, null, 2));
  process.exit(1);
}

console.log(`ok · processed=${data.processed} recorded=${data.recorded} failures=${data.failures} cost=$${data.costUsd?.toFixed?.(4) ?? data.costUsd}`);
if (data.failures > 0) {
  const errs = data.results.filter((r) => r.error);
  console.log("\nfailures:");
  for (const e of errs) console.log(`  [${e.index}] ${e.error}`);
}
