import { and, asc, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import {
  generations,
  POST_STATUS,
  posts,
  profiles,
  type Post,
  type PostStatus,
  type TrackedAccount,
} from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { INFLUENCERS } from "@/config/influencers";
import { env } from "@/lib/env";
import { loadAllCronStatus, loadAutonomyStats } from "@/lib/automation";
import { loadBilling } from "@/lib/billing";
import { loadDiscoveryFeed } from "@/lib/discovery-feed";
import { AutomationPanel } from "./automation-panel";
import { ComposePanel } from "./compose-panel";
import { DiscoverPanel } from "./discover-panel";
import { PostRow, type PostSource } from "./post-row";
import { ResetQueueButton } from "./reset-queue-button";

export const dynamic = "force-dynamic";

type GenerationMeta = {
  mode?: "ai" | "manual" | "take" | "qrt";
  viralAuthor?: string;
  viralXTweetId?: string;
  viralXUrl?: string;
  userAngle?: string | null;
};

type Loaded =
  | {
      ok: true;
      rows: Array<Post & { threadCount: number; source: PostSource | null }>;
    }
  | { ok: false; error: string };

function metaToSource(meta: GenerationMeta | null): PostSource | null {
  if (!meta || !meta.mode) return null;
  if (meta.mode === "take" || meta.mode === "qrt") {
    return {
      kind: meta.mode,
      viralAuthor: meta.viralAuthor ?? null,
      viralXTweetId: meta.viralXTweetId ?? null,
      viralXUrl: meta.viralXUrl ?? null,
    };
  }
  return { kind: meta.mode };
}

type Filter = "active" | "all" | "scheduled" | PostStatus;

const ACTIVE_STATUSES: PostStatus[] = ["draft", "approved", "scheduled", "failed"];

function parseFilter(raw: string | undefined): Filter {
  if (raw === "all") return "all";
  if (raw === "scheduled") return "scheduled";
  if (raw && (POST_STATUS as readonly string[]).includes(raw)) {
    return raw as PostStatus;
  }
  return "active";
}

async function loadPosts(filter: Filter, userId: string): Promise<Loaded> {
  try {
    const parentNull = isNull(posts.parentPostId);
    const userFilter = eq(posts.userId, userId);

    if (filter === "scheduled") {
      return loadScheduledPosts(userId);
    }

    let whereClause;
    if (filter === "all") {
      whereClause = and(parentNull, userFilter);
    } else if (filter === "active") {
      whereClause = and(parentNull, userFilter, inArray(posts.status, ACTIVE_STATUSES));
    } else {
      whereClause = and(parentNull, userFilter, eq(posts.status, filter));
    }

    const rows = await db
      .select({
        post: posts,
        generationMeta: generations.inputMeta,
      })
      .from(posts)
      .leftJoin(generations, eq(generations.id, posts.generationId))
      .where(whereClause)
      .orderBy(desc(posts.createdAt))
      .limit(50);

    const threadCounts = await db
      .select({
        parentId: posts.parentPostId,
        count: sql<number>`count(*)::int`,
      })
      .from(posts)
      .where(and(sql`${posts.parentPostId} is not null`, userFilter))
      .groupBy(posts.parentPostId);

    const byParent = new Map<string, number>();
    for (const row of threadCounts) {
      if (row.parentId) byParent.set(row.parentId, row.count);
    }

    return {
      ok: true,
      rows: rows.map(({ post, generationMeta }) => ({
        ...post,
        threadCount:
          post.contentType === "thread"
            ? (byParent.get(post.id) ?? 0) + 1
            : 0,
        source: metaToSource(generationMeta as GenerationMeta | null),
      })),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown DB error",
    };
  }
}

async function loadScheduledPosts(userId: string): Promise<Loaded> {
  try {
    const now = new Date();
    const userFilter = eq(posts.userId, userId);

    const rows = await db
      .select({ post: posts, generationMeta: generations.inputMeta })
      .from(posts)
      .leftJoin(generations, eq(generations.id, posts.generationId))
      .where(
        and(
          eq(posts.status, "approved"),
          isNull(posts.parentPostId),
          gt(posts.scheduledFor, now),
          userFilter,
        ),
      )
      .orderBy(asc(posts.scheduledFor));

    const threadCounts = await db
      .select({
        parentId: posts.parentPostId,
        count: sql<number>`count(*)::int`,
      })
      .from(posts)
      .where(and(sql`${posts.parentPostId} is not null`, userFilter))
      .groupBy(posts.parentPostId);

    const byParent = new Map<string, number>();
    for (const row of threadCounts) {
      if (row.parentId) byParent.set(row.parentId, row.count);
    }

    return {
      ok: true,
      rows: rows.map(({ post, generationMeta }) => ({
        ...post,
        threadCount:
          post.contentType === "thread"
            ? (byParent.get(post.id) ?? 0) + 1
            : 0,
        source: metaToSource(generationMeta as GenerationMeta | null),
      })),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown DB error",
    };
  }
}

async function loadCounts(userId: string): Promise<Record<string, number>> {
  const counts: Record<string, number> = {
    active: 0,
    all: 0,
    scheduled: 0,
    draft: 0,
    approved: 0,
    posted: 0,
    failed: 0,
    skipped: 0,
  };
  try {
    const rows = await db
      .select({
        status: posts.status,
        count: sql<number>`count(*)::int`,
      })
      .from(posts)
      .where(and(isNull(posts.parentPostId), eq(posts.userId, userId)))
      .groupBy(posts.status);

    for (const row of rows) {
      counts[row.status] = row.count;
      counts.all += row.count;
      if (ACTIVE_STATUSES.includes(row.status)) counts.active += row.count;
    }

    const now = new Date();
    const [scheduledRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(posts)
      .where(
        and(
          eq(posts.status, "approved"),
          isNull(posts.parentPostId),
          gt(posts.scheduledFor, now),
          eq(posts.userId, userId),
        ),
      );
    counts.scheduled = scheduledRow?.count ?? 0;
  } catch {
    // counts not critical
  }
  return counts;
}

async function loadDiscoverData(userId: string) {
  try {
    const [feedResult, profileRow] = await Promise.all([
      loadDiscoveryFeed(userId, { limit: 20, sort: "recency" }),
      db
        .select({ trackedAccounts: profiles.trackedAccounts })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1),
    ]);

    const trackedAccounts: TrackedAccount[] =
      profileRow[0]?.trackedAccounts ?? INFLUENCERS;

    // Use the most-recently-captured item's timestamp for the "fetched X ago" header.
    const mostRecentItem =
      feedResult.items.length > 0 ? feedResult.items[0] : null;

    return {
      initialItems: feedResult.items.map((item) => ({
        ...item,
        capturedAt: item.capturedAt.toISOString(),
      })),
      initialTotal: feedResult.total,
      trackedAccounts,
      lastFetch: mostRecentItem
        ? mostRecentItem.capturedAt.toISOString()
        : null,
    };
  } catch {
    return null;
  }
}

async function loadAutomationData(userId: string) {
  try {
    const [jobs, stats, billing, profile] = await Promise.all([
      loadAllCronStatus(),
      loadAutonomyStats(),
      loadBilling(),
      db
        .select({ waveAutonomous: profiles.waveAutonomous })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1),
    ]);
    const todaySpend = billing?.today.totalUsd ?? 0;
    const cap = env.MAX_DAILY_USD;
    const serializedJobs = jobs.map((j) => ({
      ...j,
      lastRunAt: j.lastRunAt ? j.lastRunAt.toISOString() : null,
    }));
    return {
      jobs: serializedJobs,
      stats,
      todaySpend,
      cap,
      waveAutonomous: profile[0]?.waveAutonomous ?? false,
    };
  } catch {
    return null;
  }
}

const FILTER_TABS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "active" },
  { value: "draft", label: "draft" },
  { value: "scheduled", label: "scheduled" },
  { value: "posted", label: "posted" },
  { value: "failed", label: "failed" },
  { value: "skipped", label: "skipped" },
  { value: "all", label: "all" },
];

type QueuePageProps = {
  searchParams: Promise<{ filter?: string }>;
};

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const user = await requireUser();
  const { filter: filterRaw } = await searchParams;
  const filter = parseFilter(filterRaw);
  const [result, counts, automation, discover] = await Promise.all([
    loadPosts(filter, user.id),
    loadCounts(user.id),
    loadAutomationData(user.id),
    loadDiscoverData(user.id),
  ]);

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">
            Review, schedule, and ship your drafts.
          </p>
        </div>
        <ResetQueueButton activeCount={counts.active} />
      </header>

      <ComposePanel />

      {discover && (
        <DiscoverPanel
          initialItems={discover.initialItems}
          initialTotal={discover.initialTotal}
          trackedAccounts={discover.trackedAccounts}
          lastFetch={discover.lastFetch}
        />
      )}

      {automation && (
        <AutomationPanel
          stats={automation.stats}
          jobs={automation.jobs}
          todaySpend={automation.todaySpend}
          cap={automation.cap}
          waveAutonomous={automation.waveAutonomous}
        />
      )}

      <nav className="flex flex-wrap gap-1 font-mono text-xs">
        {FILTER_TABS.map((tab) => {
          const isActive = filter === tab.value;
          const count = counts[tab.value] ?? 0;
          const href = tab.value === "active" ? "/queue" : `/queue?filter=${tab.value}`;
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
      </nav>

      {!result.ok ? (
        <DbErrorState message={result.error} />
      ) : result.rows.length === 0 ? (
        <EmptyState filter={filter} />
      ) : (
        <div className="flex flex-col gap-3">
          {result.rows.map((row) => (
            <PostRow
              key={row.id}
              post={row}
              threadCount={row.threadCount || undefined}
              source={row.source}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <p className="text-sm font-medium">
        No posts in <span className="font-mono">{filter}</span>.
      </p>
      <p className="text-sm text-muted-foreground">
        {filter === "active" ? (
          <>
            Head to <Link href="/compose" className="underline">Compose</Link>{" "}
            and draft something.
          </>
        ) : filter === "scheduled" ? (
          <>Schedule posts from the active queue.</>
        ) : (
          <>Try a different filter above.</>
        )}
      </p>
    </div>
  );
}

function DbErrorState({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-6">
      <p className="text-sm font-semibold text-destructive">
        Couldn&apos;t reach the database.
      </p>
      <p className="text-sm text-muted-foreground">
        Check that <code className="font-mono">DATABASE_URL</code> is set and
        the migration has been applied.
      </p>
      <pre className="max-w-2xl overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-xs">
        {message}
      </pre>
    </div>
  );
}
