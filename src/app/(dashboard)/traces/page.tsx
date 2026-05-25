import { desc, eq, sql } from "drizzle-orm";
import Link from "next/link";
import { AutoRefresh } from "@/components/shell/auto-refresh";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { generations, traces, type Trace } from "@/db/schema";

export const dynamic = "force-dynamic";

type GenInfo = {
  topic: string | null;
  inputMeta: Record<string, unknown> | null;
  status: string | null;
  costUsd: string | null;
  model: string | null;
};

type EnrichedTrace = Trace & { generation: GenInfo | null };

type Loaded =
  | { ok: true; rows: EnrichedTrace[] }
  | { ok: false; error: string };

async function loadTraces(agentFilter: string | null): Promise<Loaded> {
  try {
    const baseQuery = db
      .select({
        id: traces.id,
        generationId: traces.generationId,
        agent: traces.agent,
        eventType: traces.eventType,
        payload: traces.payload,
        model: traces.model,
        tokensIn: traces.tokensIn,
        tokensOut: traces.tokensOut,
        costUsd: traces.costUsd,
        ts: traces.ts,
        genTopic: generations.topic,
        genInputMeta: generations.inputMeta,
        genStatus: generations.status,
        genCost: generations.costUsd,
        genModel: generations.model,
      })
      .from(traces)
      .leftJoin(generations, eq(generations.id, traces.generationId));

    const rows = agentFilter
      ? await baseQuery
          .where(eq(traces.agent, agentFilter))
          .orderBy(desc(traces.ts))
          .limit(300)
      : await baseQuery.orderBy(desc(traces.ts)).limit(300);

    const enriched: EnrichedTrace[] = rows.map((r) => ({
      id: r.id,
      userId: null,
      generationId: r.generationId,
      agent: r.agent,
      eventType: r.eventType,
      payload: r.payload,
      model: r.model,
      tokensIn: r.tokensIn,
      tokensOut: r.tokensOut,
      costUsd: r.costUsd,
      ts: r.ts,
      generation: r.genTopic
        ? {
            topic: r.genTopic,
            inputMeta: r.genInputMeta as Record<string, unknown> | null,
            status: r.genStatus,
            costUsd: r.genCost,
            model: r.genModel,
          }
        : null,
    }));

    return { ok: true, rows: enriched };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown DB error",
    };
  }
}

async function loadAgentCounts(): Promise<Array<{ agent: string; c: number }>> {
  try {
    const rows = await db
      .select({ agent: traces.agent, c: sql<number>`count(*)::int` })
      .from(traces)
      .groupBy(traces.agent)
      .orderBy(desc(sql<number>`count(*)`));
    return rows;
  } catch {
    return [];
  }
}

function fmtTs(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace("T", " ").slice(0, 19);
}

function fmtCost(c: string | null): string {
  if (!c) return "—";
  const n = Number(c);
  if (n === 0) return "$0";
  if (n < 0.0001) return "<$0.0001";
  return `$${n.toFixed(5)}`;
}

function agentColor(agent: string): string {
  if (agent === "writer") return "text-sky-700 dark:text-sky-400";
  if (agent === "editor") return "text-amber-700 dark:text-amber-400";
  if (agent === "take") return "text-violet-700 dark:text-violet-400";
  if (agent === "qrt") return "text-fuchsia-700 dark:text-fuchsia-400";
  if (agent === "poster") return "text-emerald-700 dark:text-emerald-400";
  if (agent === "discover") return "text-cyan-700 dark:text-cyan-400";
  if (agent === "compose") return "text-foreground";
  if (agent.startsWith("cron")) return "text-orange-700 dark:text-orange-400";
  return "text-muted-foreground";
}

type TracesPageProps = {
  searchParams: Promise<{ agent?: string }>;
};

export default async function TracesPage({ searchParams }: TracesPageProps) {
  const { agent } = await searchParams;
  const agentFilter = agent && agent !== "all" ? agent : null;

  const [result, agentCounts] = await Promise.all([
    loadTraces(agentFilter),
    loadAgentCounts(),
  ]);

  // Group by generation_id (null = standalone group, one per trace)
  const groups = new Map<string, EnrichedTrace[]>();
  const standalones: EnrichedTrace[] = [];

  if (result.ok) {
    for (const t of result.rows) {
      if (t.generationId) {
        const list = groups.get(t.generationId) ?? [];
        list.push(t);
        groups.set(t.generationId, list);
      } else {
        standalones.push(t);
      }
    }
  }

  const sortedGroups = Array.from(groups.entries()).sort((a, b) => {
    const aT = a[1][0]?.ts ?? new Date(0);
    const bT = b[1][0]?.ts ?? new Date(0);
    return new Date(bT).getTime() - new Date(aT).getTime();
  });

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Traces</h1>
          <p className="text-sm text-muted-foreground">
            Agent events: writer, editor, take, QRT, poster, discover, cron,
            topic-guard, telegram. Latest 300 events. Grouped by generation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AutoRefresh intervalMs={15_000} label="live" />
          <Badge variant="outline" className="font-mono">
            slice 5
          </Badge>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 font-mono text-xs">
        <Link
          href="/traces"
          className={`rounded-md px-2 py-1 ${
            !agentFilter
              ? "bg-foreground text-background"
              : "bg-muted text-muted-foreground hover:bg-muted/70"
          }`}
        >
          all
        </Link>
        {agentCounts.map((a) => (
          <Link
            key={a.agent}
            href={`/traces?agent=${encodeURIComponent(a.agent)}`}
            className={`rounded-md px-2 py-1 ${
              agentFilter === a.agent
                ? "bg-foreground text-background"
                : "bg-muted text-muted-foreground hover:bg-muted/70"
            }`}
          >
            <span className={agentColor(a.agent)}>{a.agent}</span>
            <span className="ml-1 opacity-50">{a.c}</span>
          </Link>
        ))}
      </nav>

      {!result.ok ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6 font-mono text-xs text-destructive">
          {result.error}
        </div>
      ) : sortedGroups.length === 0 && standalones.length === 0 ? (
        <div className="rounded-lg border border-dashed p-8 text-sm text-muted-foreground">
          No traces yet. Generate a draft to see agents emit events.
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {sortedGroups.map(([genId, events]) => {
            const gen = events[0]?.generation ?? null;
            return (
              <details
                key={genId}
                open
                className="rounded-lg border bg-card p-4"
              >
                <summary className="flex flex-wrap items-center gap-3 text-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                  <Badge variant="outline" className="font-mono">
                    {gen?.inputMeta && typeof gen.inputMeta === "object"
                      ? ((gen.inputMeta as { mode?: string }).mode ?? "gen")
                      : "gen"}
                  </Badge>
                  <span className="font-medium truncate max-w-md">
                    {gen?.topic ?? `generation ${genId.slice(0, 8)}`}
                  </span>
                  <span className="ml-auto font-mono text-xs text-muted-foreground">
                    {fmtCost(gen?.costUsd ?? null)} · {events.length} events
                  </span>
                </summary>
                <div className="mt-3 flex flex-col gap-1 font-mono text-xs">
                  {[...events].reverse().map((ev) => (
                    <div
                      key={ev.id}
                      className="grid grid-cols-[120px_180px_1fr_auto] items-baseline gap-3 border-t pt-2"
                    >
                      <span className="text-muted-foreground">
                        {fmtTs(ev.ts)}
                      </span>
                      <span>
                        <span className={agentColor(ev.agent)}>{ev.agent}</span>
                        <span className="text-muted-foreground">
                          .{ev.eventType}
                        </span>
                      </span>
                      <span className="truncate text-muted-foreground">
                        {ev.model ? `${ev.model} · ` : ""}
                        {ev.tokensIn !== null && ev.tokensIn !== undefined
                          ? `${ev.tokensIn}/${ev.tokensOut} tok · `
                          : ""}
                        {ev.payload && typeof ev.payload === "object"
                          ? Object.entries(
                              ev.payload as Record<string, unknown>,
                            )
                              .filter(([k]) => k !== "viralXUrl")
                              .slice(0, 3)
                              .map(([k, v]) => `${k}:${formatVal(v)}`)
                              .join(" · ")
                          : ""}
                      </span>
                      <span className="text-muted-foreground">
                        {fmtCost(ev.costUsd)}
                      </span>
                    </div>
                  ))}
                </div>
              </details>
            );
          })}

          {standalones.length > 0 ? (
            <details open className="rounded-lg border bg-card p-4">
              <summary className="flex flex-wrap items-center gap-3 text-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden">
                <Badge variant="outline" className="font-mono">
                  standalone
                </Badge>
                <span className="font-medium">
                  cron / discover / system events
                </span>
                <span className="ml-auto font-mono text-xs text-muted-foreground">
                  {standalones.length} events
                </span>
              </summary>
              <div className="mt-3 flex flex-col gap-1 font-mono text-xs">
                {standalones.map((ev) => (
                  <div
                    key={ev.id}
                    className="grid grid-cols-[120px_180px_1fr_auto] items-baseline gap-3 border-t pt-2"
                  >
                    <span className="text-muted-foreground">
                      {fmtTs(ev.ts)}
                    </span>
                    <span>
                      <span className={agentColor(ev.agent)}>{ev.agent}</span>
                      <span className="text-muted-foreground">
                        .{ev.eventType}
                      </span>
                    </span>
                    <span className="truncate text-muted-foreground">
                      {ev.payload && typeof ev.payload === "object"
                        ? Object.entries(ev.payload as Record<string, unknown>)
                            .slice(0, 4)
                            .map(([k, v]) => `${k}:${formatVal(v)}`)
                            .join(" · ")
                        : ""}
                    </span>
                    <span className="text-muted-foreground">
                      {fmtCost(ev.costUsd)}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          ) : null}
        </div>
      )}
    </div>
  );
}

function formatVal(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    return v.length > 30 ? `${v.slice(0, 30)}…` : v;
  }
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return `[${v.length}]`;
  if (typeof v === "object") return "{…}";
  return String(v);
}
