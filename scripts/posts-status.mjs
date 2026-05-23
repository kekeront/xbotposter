// Snapshot of posts queue to diagnose why cron post isn't shipping.
//   - counts by status
//   - lists approved posts and whether they have a scheduled_for in the past
//   - lists last 10 posts overall

import postgres from "postgres";
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

const sql = postgres(process.env.DATABASE_URL, { prepare: false, max: 1 });

try {
  const counts = await sql`
    SELECT status, COUNT(*)::int AS n FROM posts GROUP BY status ORDER BY n DESC
  `;
  console.log("\n=== posts by status ===");
  if (!counts.length) console.log("(no posts yet)");
  for (const c of counts) console.log(`  ${c.status.padEnd(10)} ${c.n}`);

  const due = await sql`
    SELECT id, status, scheduled_for, parent_post_id, LEFT(text, 60) AS preview
    FROM posts
    WHERE status = 'approved' AND parent_post_id IS NULL
    ORDER BY scheduled_for ASC NULLS LAST
    LIMIT 10
  `;
  console.log("\n=== approved root posts (what cron/post tries to ship) ===");
  if (!due.length) console.log("(none — nothing is queued to post)");
  for (const r of due) {
    const when = r.scheduled_for
      ? new Date(r.scheduled_for).toISOString()
      : "NULL (won't match lte filter)";
    const overdue = r.scheduled_for && new Date(r.scheduled_for) <= new Date();
    console.log(`  ${r.id.slice(0, 8)}  sched: ${when}  ${overdue ? "DUE" : "future"}  · ${r.preview}…`);
  }

  const recent = await sql`
    SELECT id, status, scheduled_for, posted_at, x_tweet_id, LEFT(text, 60) AS preview
    FROM posts
    ORDER BY created_at DESC
    LIMIT 10
  `;
  console.log("\n=== last 10 posts (any status) ===");
  for (const r of recent) {
    console.log(`  ${r.id.slice(0, 8)}  ${r.status.padEnd(10)} ${r.x_tweet_id ?? "—"}  · ${r.preview}…`);
  }
} catch (e) {
  console.error("error:", e.message);
}
await sql.end();
