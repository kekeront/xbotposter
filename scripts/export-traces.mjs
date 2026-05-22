// Dumps the latest agent traces to traces/agent-traces.{json,md}.
// Used to ship a snapshot of agent execution history alongside the source —
// part of the assignment deliverable.

import postgres from "postgres";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";

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

const traces = await sql`
  SELECT t.id, t.generation_id, t.agent, t.event_type, t.payload, t.model,
         t.tokens_in, t.tokens_out, t.cost_usd, t.ts,
         g.topic AS gen_topic, g.input_meta AS gen_input_meta,
         g.status AS gen_status, g.cost_usd AS gen_total_cost
  FROM traces t
  LEFT JOIN generations g ON g.id = t.generation_id
  ORDER BY t.ts DESC
  LIMIT 200
`;

mkdirSync("traces", { recursive: true });

writeFileSync(
  "traces/agent-traces.json",
  JSON.stringify(traces, null, 2),
  "utf-8",
);

const byGen = new Map();
const standalones = [];
for (const t of traces) {
  if (t.generation_id) {
    if (!byGen.has(t.generation_id)) byGen.set(t.generation_id, []);
    byGen.get(t.generation_id).push(t);
  } else {
    standalones.push(t);
  }
}

const md = [];
md.push("# Agent traces");
md.push("");
md.push(
  `Latest ${traces.length} agent events from the live nfactz database, exported by \`scripts/export-traces.mjs\`. Each generation is one user-triggered or cron-triggered run through the multi-agent pipeline.`,
);
md.push("");

for (const [genId, events] of byGen.entries()) {
  events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const first = events[0];
  const topic = first.gen_topic ?? `generation ${genId.slice(0, 8)}`;
  const meta = (first.gen_input_meta ?? {});
  const mode = meta.mode ?? "?";
  const status = first.gen_status ?? "?";
  const totalCost = first.gen_total_cost ?? "0";
  md.push(`## ${topic.length > 100 ? topic.slice(0, 100) + "…" : topic}`);
  md.push("");
  md.push(
    `- mode: \`${mode}\` · status: \`${status}\` · total cost: $${Number(totalCost).toFixed(5)}`,
  );
  md.push("");
  md.push("| Time | Agent | Event | Model | Tokens | Cost |");
  md.push("|---|---|---|---|---|---|");
  for (const ev of events) {
    const tokens =
      ev.tokens_in != null && ev.tokens_out != null
        ? `${ev.tokens_in}/${ev.tokens_out}`
        : "—";
    const cost = ev.cost_usd ? `$${Number(ev.cost_usd).toFixed(5)}` : "—";
    md.push(
      `| ${ev.ts.toISOString().slice(11, 19)} | \`${ev.agent}\` | \`${ev.event_type}\` | ${ev.model ?? "—"} | ${tokens} | ${cost} |`,
    );
  }
  md.push("");
  if (meta.outlineBeats) {
    md.push("**Outline beats:**");
    md.push("");
    for (const beat of meta.outlineBeats) md.push(`- ${beat}`);
    md.push("");
  }
  if (meta.winnerEval) {
    md.push(
      `**Winner eval:** overall ${meta.winnerEval.overall}/100 · critique: ${meta.winnerEval.critique}`,
    );
    md.push("");
  }
}

if (standalones.length > 0) {
  md.push("## Standalone events (cron / system)");
  md.push("");
  md.push("| Time | Agent | Event | Payload |");
  md.push("|---|---|---|---|");
  for (const ev of standalones) {
    md.push(
      `| ${ev.ts.toISOString().slice(11, 19)} | \`${ev.agent}\` | \`${ev.event_type}\` | ${JSON.stringify(ev.payload).slice(0, 80)} |`,
    );
  }
}

writeFileSync("traces/agent-traces.md", md.join("\n"), "utf-8");

console.log(
  `exported ${traces.length} traces → traces/agent-traces.{json,md}`,
);
await sql.end();
process.exit(0);
