// Read-only cost inspector. After running a compose in the UI, run:
//   node scripts/check-cost.mjs
// Prints the most recent generation's total cost/tokens and a per-agent
// breakdown from the traces table, so you can see the searcher's real cost.
// SELECT-only — it never writes or publishes anything.

import { readFileSync } from "node:fs";
import postgres from "postgres";

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

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL not set in .env.local");
  process.exit(1);
}

const usd = (v) => `$${Number(v ?? 0).toFixed(4)}`;
const sql = postgres(url, { max: 1 });

try {
  const [gen] = await sql`
    select id, topic, model, status, tokens_in, tokens_out, cost_usd,
           created_at, completed_at
    from generations
    order by created_at desc
    limit 1
  `;

  if (!gen) {
    console.log("No generations found yet — run a compose first.");
    process.exit(0);
  }

  console.log("\n=== latest generation ===");
  console.log(`id        ${gen.id}`);
  console.log(`topic     ${String(gen.topic).slice(0, 80)}`);
  console.log(`status    ${gen.status}`);
  console.log(`model     ${gen.model ?? "—"}`);
  console.log(`tokens    in ${gen.tokens_in} / out ${gen.tokens_out}`);
  console.log(`COST      ${usd(gen.cost_usd)}`);
  console.log(`created   ${gen.created_at?.toISOString?.() ?? gen.created_at}`);

  const traces = await sql`
    select agent, event_type, model, tokens_in, tokens_out, cost_usd
    from traces
    where generation_id = ${gen.id} and cost_usd is not null
    order by ts asc
  `;

  // Aggregate cost/tokens per agent.
  const byAgent = new Map();
  for (const t of traces) {
    const a = byAgent.get(t.agent) ?? { cost: 0, tin: 0, tout: 0, calls: 0 };
    a.cost += Number(t.cost_usd ?? 0);
    a.tin += Number(t.tokens_in ?? 0);
    a.tout += Number(t.tokens_out ?? 0);
    a.calls += 1;
    byAgent.set(t.agent, a);
  }

  console.log("\n=== per-agent breakdown (from traces) ===");
  console.log("agent          calls   tokensIn  tokensOut       cost");
  for (const [agent, a] of byAgent) {
    console.log(
      `${agent.padEnd(14)} ${String(a.calls).padStart(5)} ${String(a.tin).padStart(10)} ${String(a.tout).padStart(10)}   ${usd(a.cost).padStart(9)}`,
    );
  }

  const searcher = byAgent.get("searcher");
  console.log("\n=== searcher (the one we just optimized) ===");
  if (searcher) {
    console.log(
      `cost ${usd(searcher.cost)} · tokens in ${searcher.tin} / out ${searcher.tout} · ${searcher.calls} call(s)`,
    );
  } else {
    console.log("no searcher trace on this generation (search may have returned nothing).");
  }
  console.log("");
} finally {
  await sql.end({ timeout: 5 });
}
