// Local cron simulator. Runs three setIntervals on the same schedules as
// vercel.json so you can do fully-autonomous workflows on your laptop
// without deploying.
//
// Usage:
//   1. npm run dev          (in one terminal)
//   2. npm run cron:local   (in another terminal — this script)
//
// Logs each run + outcome. Respects MAX_DAILY_USD via the cron endpoints'
// built-in spend cap. Stop with Ctrl+C.

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

const secret = process.env.CRON_SECRET;
if (!secret) {
  console.error("CRON_SECRET not set in .env.local — required for local cron");
  process.exit(1);
}

const BASE = process.env.LOCAL_BASE_URL ?? "http://localhost:3000";
const JOBS = [
  // [path, intervalMs, label]
  ["/api/cron/discover", 12 * 60 * 60 * 1000, "discover"],
  ["/api/cron/generate", 4 * 60 * 60 * 1000, "generate"],
  ["/api/cron/post", 15 * 60 * 1000, "post"],
];

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

async function fire(path, label) {
  const start = Date.now();
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    const data = await res.json().catch(() => ({}));
    const ms = Date.now() - start;
    if (!res.ok) {
      console.log(
        `[${ts()}] ${label.padEnd(8)} → ${res.status} in ${ms}ms · ${JSON.stringify(data).slice(0, 200)}`,
      );
      return;
    }
    // Compact one-line summary per job kind.
    let summary = "";
    if (data.skipped) summary = `skipped: ${data.skipped}`;
    else if (data.generated) summary = `generated: @${data.generated.viralAuthor} eval=${data.generated.evalOverall}`;
    else if (data.tweetsCaptured !== undefined) summary = `captured ${data.tweetsCaptured} tweets`;
    else if (data.processed !== undefined) summary = `processed ${data.processed} scheduled posts`;
    else summary = JSON.stringify(data).slice(0, 200);
    console.log(`[${ts()}] ${label.padEnd(8)} → ok in ${ms}ms · ${summary}`);
  } catch (err) {
    console.log(`[${ts()}] ${label.padEnd(8)} → ERR: ${err.message ?? err}`);
  }
}

console.log(`[${ts()}] local cron runner started. Base: ${BASE}`);
console.log(`[${ts()}] schedules: ${JOBS.map(([, ms, l]) => `${l}=${ms / 60000}m`).join(" · ")}`);
console.log(`[${ts()}] tip: set RUN_ON_START=1 to fire each job once immediately\n`);

if (process.env.RUN_ON_START === "1") {
  for (const [path, , label] of JOBS) {
    await fire(path, label);
  }
}

for (const [path, intervalMs, label] of JOBS) {
  setInterval(() => fire(path, label), intervalMs);
}

// Keep process alive forever.
setInterval(() => {}, 1 << 30);
