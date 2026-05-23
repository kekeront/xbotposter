import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import {
  memories,
  MEMORY_TYPE,
  type Memory,
  type MemoryType,
} from "@/db/schema";
import { RowActions } from "./row-actions";

export const dynamic = "force-dynamic";

type Filter = "all" | MemoryType;
const VALID_TYPES = new Set<string>(MEMORY_TYPE);

function parseFilter(raw: string | undefined): Filter {
  if (raw === "all") return "all";
  if (raw && VALID_TYPES.has(raw)) return raw as MemoryType;
  return "all";
}

type Loaded =
  | { ok: true; rows: Memory[]; counts: Record<MemoryType, number>; total: number }
  | { ok: false; error: string };

async function load(filter: Filter, showSuperseded: boolean, search: string): Promise<Loaded> {
  try {
    const whereParts = [];
    if (!showSuperseded) whereParts.push(isNull(memories.supersededAt));
    if (filter !== "all") whereParts.push(eq(memories.type, filter));
    if (search) {
      whereParts.push(
        sql`(${memories.slot} ILIKE ${`%${search}%`} OR ${memories.content} ILIKE ${`%${search}%`})`,
      );
    }
    const rows = await db
      .select()
      .from(memories)
      .where(whereParts.length > 0 ? and(...whereParts) : undefined)
      .orderBy(
        asc(memories.type),
        desc(memories.confidence),
        desc(memories.createdAt),
      )
      .limit(200);

    const countsRows = await db
      .select({ type: memories.type, n: sql<number>`count(*)::int` })
      .from(memories)
      .where(isNull(memories.supersededAt))
      .groupBy(memories.type);
    const counts: Record<MemoryType, number> = {
      fact: 0,
      preference: 0,
      opinion: 0,
      event: 0,
    };
    let total = 0;
    for (const c of countsRows) {
      counts[c.type] = c.n;
      total += c.n;
    }

    return { ok: true, rows, counts, total };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "db error" };
  }
}

const TYPE_TABS: Array<{ value: Filter; label: string }> = [
  { value: "all", label: "all" },
  { value: "fact", label: "fact" },
  { value: "preference", label: "pref" },
  { value: "opinion", label: "opinion" },
  { value: "event", label: "event" },
];

const TYPE_COLOR: Record<MemoryType, string> = {
  fact: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  preference: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  opinion: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  event: "bg-purple-500/15 text-purple-700 dark:text-purple-300",
};

type PageProps = {
  searchParams: Promise<{ type?: string; q?: string; showSuperseded?: string }>;
};

export default async function MemoriesPage({ searchParams }: PageProps) {
  const { type, q, showSuperseded } = await searchParams;
  const filter = parseFilter(type);
  const search = (q ?? "").trim();
  const showAll = showSuperseded === "1";
  const result = await load(filter, showAll, search);

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Memory layer</h1>
          <p className="text-sm text-muted-foreground">
            Typed assertions accumulated from posts, feedback, and seed dumps. The
            writer / take / qrt agents see active memories in their system prompt.
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          {result.ok ? `${result.total} active` : "error"}
        </Badge>
      </header>

      <nav className="flex flex-wrap items-center gap-3">
        <div className="flex flex-wrap gap-1 font-mono text-xs">
          {TYPE_TABS.map((tab) => {
            const isActive = filter === tab.value;
            const params = new URLSearchParams();
            if (tab.value !== "all") params.set("type", tab.value);
            if (search) params.set("q", search);
            if (showAll) params.set("showSuperseded", "1");
            const href = `/memories${params.toString() ? `?${params}` : ""}`;
            const count =
              tab.value === "all"
                ? result.ok
                  ? result.total
                  : 0
                : result.ok
                  ? result.counts[tab.value]
                  : 0;
            return (
              <Link
                key={tab.value}
                href={href}
                className={`rounded-md px-2 py-1 transition-colors ${
                  isActive
                    ? "bg-foreground text-background"
                    : "bg-muted text-muted-foreground hover:bg-muted/70"
                }`}
              >
                {tab.label}
                <span className={isActive ? "ml-1 opacity-70" : "ml-1 opacity-50"}>
                  {count}
                </span>
              </Link>
            );
          })}
        </div>
        <form className="ml-auto flex items-center gap-2" method="get">
          {filter !== "all" ? (
            <input type="hidden" name="type" value={filter} />
          ) : null}
          {showAll ? <input type="hidden" name="showSuperseded" value="1" /> : null}
          <input
            type="search"
            name="q"
            defaultValue={search}
            placeholder="search slot or content…"
            className="w-64 rounded-md border bg-background px-2 py-1 font-mono text-xs"
          />
        </form>
      </nav>

      {!result.ok ? (
        <DbError message={result.error} />
      ) : result.rows.length === 0 ? (
        <EmptyState filter={filter} hasSearch={!!search} />
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left font-mono text-xs uppercase text-muted-foreground">
              <tr>
                <th className="px-3 py-2">type</th>
                <th className="px-3 py-2">slot</th>
                <th className="px-3 py-2">content</th>
                <th className="px-3 py-2 text-right">conf</th>
                <th className="px-3 py-2">source</th>
                <th className="px-3 py-2">created</th>
                <th className="px-3 py-2">actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {result.rows.map((m) => {
                const isSuperseded = m.supersededAt !== null;
                return (
                  <tr
                    key={m.id}
                    className={isSuperseded ? "opacity-40" : "align-top"}
                  >
                    <td className="px-3 py-2">
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-xs ${TYPE_COLOR[m.type]}`}
                      >
                        {m.type}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">{m.slot}</td>
                    <td className="px-3 py-2">{m.content}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">
                      {m.confidence}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {m.sourceKind ?? "—"}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-muted-foreground">
                      {m.createdAt.toISOString().slice(0, 10)}
                    </td>
                    <td className="px-3 py-2">
                      {isSuperseded ? (
                        <span className="font-mono text-xs italic text-muted-foreground">
                          superseded
                        </span>
                      ) : (
                        <RowActions memoryId={m.id} />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function EmptyState({ filter, hasSearch }: { filter: Filter; hasSearch: boolean }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <p className="text-sm font-medium">
        No memories in <span className="font-mono">{filter}</span>
        {hasSearch ? " matching that search" : ""}.
      </p>
      <p className="text-sm text-muted-foreground">
        Memories accumulate when you post, skip, or unapprove drafts. To
        bootstrap with your Telegram channel: POST a JSON array of posts to{" "}
        <code className="font-mono">/api/memories/seed</code> or use{" "}
        <code className="font-mono">npm run seed:tg &lt;file.txt&gt;</code>.
      </p>
    </div>
  );
}

function DbError({ message }: { message: string }) {
  return (
    <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <p className="text-sm font-semibold text-destructive">DB error</p>
      <pre className="mt-2 max-w-2xl overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
        {message}
      </pre>
      <p className="mt-2 text-xs text-muted-foreground">
        Did you apply <code className="font-mono">0002_memories.sql</code> in the
        Supabase SQL editor?
      </p>
    </div>
  );
}
