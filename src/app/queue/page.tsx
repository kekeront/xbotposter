import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db/client";
import {
  generations,
  POST_STATUS,
  posts,
  type Post,
  type PostStatus,
} from "@/db/schema";
import { ClearQueueButton } from "./clear-button";
import { PostRow, type PostSource } from "./post-row";

export const dynamic = "force-dynamic";

type GenerationMeta = {
  mode?: "ai" | "manual" | "take" | "qrt";
  viralAuthor?: string;
  viralXTweetId?: string;
  viralXUrl?: string;
  userAngle?: string | null;
  eval?: { overall?: number };
  winnerEval?: { overall?: number };
};

type EnrichedPost = Post & {
  threadCount: number;
  source: PostSource | null;
  evalOverall: number | null;
};

type Loaded =
  | { ok: true; rows: EnrichedPost[] }
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

function metaToEval(meta: GenerationMeta | null): number | null {
  if (!meta) return null;
  const v = meta.winnerEval?.overall ?? meta.eval?.overall;
  return typeof v === "number" ? v : null;
}

type Filter = "active" | "all" | PostStatus;

const ACTIVE_STATUSES: PostStatus[] = ["draft", "approved", "scheduled", "failed"];

// Priority order when rendering grouped active view — most actionable first.
const STATUS_ORDER: PostStatus[] = [
  "scheduled",
  "approved",
  "draft",
  "failed",
  "posted",
  "skipped",
];

const STATUS_LABEL: Record<PostStatus, string> = {
  scheduled: "Scheduled",
  approved: "Approved",
  draft: "Drafts to review",
  failed: "Failed (retryable)",
  posted: "Posted",
  skipped: "Skipped",
};

const STATUS_HINT: Record<PostStatus, string> = {
  scheduled: "Will ship at scheduled time via /api/cron/post",
  approved: "Auto-approved or queued for the next cron tick",
  draft: "Awaiting your review",
  failed: "Failed to ship — fix and retry",
  posted: "Live on X",
  skipped: "Manually skipped",
};

function parseFilter(raw: string | undefined): Filter {
  if (raw === "all") return "all";
  if (raw && (POST_STATUS as readonly string[]).includes(raw)) {
    return raw as PostStatus;
  }
  return "active";
}

async function loadPosts(filter: Filter): Promise<Loaded> {
  try {
    const parentNull = isNull(posts.parentPostId);
    let whereClause;
    if (filter === "all") {
      whereClause = parentNull;
    } else if (filter === "active") {
      whereClause = and(parentNull, inArray(posts.status, ACTIVE_STATUSES));
    } else {
      whereClause = and(parentNull, eq(posts.status, filter));
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
      .where(sql`${posts.parentPostId} is not null`)
      .groupBy(posts.parentPostId);

    const byParent = new Map<string, number>();
    for (const row of threadCounts) {
      if (row.parentId) byParent.set(row.parentId, row.count);
    }

    return {
      ok: true,
      rows: rows.map(({ post, generationMeta }) => {
        const meta = generationMeta as GenerationMeta | null;
        return {
          ...post,
          threadCount:
            post.contentType === "thread"
              ? (byParent.get(post.id) ?? 0) + 1
              : 0,
          source: metaToSource(meta),
          evalOverall: metaToEval(meta),
        };
      }),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown DB error",
    };
  }
}

async function loadCounts(): Promise<Record<Filter, number>> {
  const counts: Record<Filter, number> = {
    active: 0,
    all: 0,
    draft: 0,
    approved: 0,
    scheduled: 0,
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
      .where(isNull(posts.parentPostId))
      .groupBy(posts.status);

    for (const row of rows) {
      counts[row.status] = row.count;
      counts.all += row.count;
      if (ACTIVE_STATUSES.includes(row.status)) counts.active += row.count;
    }
  } catch {
    // ignore — counts not critical
  }
  return counts;
}

const FILTER_TABS: Array<{ value: Filter; label: string }> = [
  { value: "active", label: "active" },
  { value: "draft", label: "draft" },
  { value: "posted", label: "posted" },
  { value: "failed", label: "failed" },
  { value: "skipped", label: "skipped" },
  { value: "all", label: "all" },
];

type QueuePageProps = {
  searchParams: Promise<{ filter?: string }>;
};

export default async function QueuePage({ searchParams }: QueuePageProps) {
  const { filter: filterRaw } = await searchParams;
  const filter = parseFilter(filterRaw);
  const [result, counts] = await Promise.all([loadPosts(filter), loadCounts()]);

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">
            Review, skip, or ship drafts. Threads post as chained replies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ClearQueueButton
            statuses={["draft"]}
            label="Clear drafts"
            count={counts.draft}
          />
          <ClearQueueButton
            statuses={["skipped", "failed"]}
            label="Clear skipped + failed"
            count={counts.skipped + counts.failed}
          />
        </div>
      </header>

      <nav className="flex flex-wrap gap-1 font-mono text-xs">
        {FILTER_TABS.map((tab) => {
          const isActive = filter === tab.value;
          const count = counts[tab.value];
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
      ) : filter === "active" ? (
        <GroupedView rows={result.rows} />
      ) : (
        <FlatView rows={result.rows} />
      )}
    </div>
  );
}

function GroupedView({ rows }: { rows: EnrichedPost[] }) {
  // Bucket by status, render sections in STATUS_ORDER, skip empty buckets.
  const byStatus = new Map<PostStatus, EnrichedPost[]>();
  for (const r of rows) {
    if (!byStatus.has(r.status)) byStatus.set(r.status, []);
    byStatus.get(r.status)!.push(r);
  }

  return (
    <div className="flex flex-col gap-8">
      {STATUS_ORDER.filter((s) => byStatus.has(s)).map((status) => {
        const items = byStatus.get(status)!;
        return (
          <section key={status} className="flex flex-col gap-3">
            <h2 className="flex items-baseline gap-2 font-mono text-xs uppercase tracking-wider text-muted-foreground">
              <span>{STATUS_LABEL[status]}</span>
              <span className="opacity-50">·</span>
              <span>{items.length}</span>
              <span className="ml-auto text-[10px] normal-case opacity-70">
                {STATUS_HINT[status]}
              </span>
            </h2>
            <div className="flex flex-col gap-3">
              {items.map((row) => (
                <PostRow
                  key={row.id}
                  post={row}
                  threadCount={row.threadCount || undefined}
                  source={row.source}
                  evalOverall={row.evalOverall}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function FlatView({ rows }: { rows: EnrichedPost[] }) {
  return (
    <div className="flex flex-col gap-3">
      {rows.map((row) => (
        <PostRow
          key={row.id}
          post={row}
          threadCount={row.threadCount || undefined}
          source={row.source}
          evalOverall={row.evalOverall}
        />
      ))}
    </div>
  );
}

function EmptyState({ filter }: { filter: Filter }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <p className="text-sm font-medium">
        {filter === "active"
          ? "Nothing in the queue."
          : `No posts in ${filter}.`}
      </p>
      <p className="text-sm text-muted-foreground">
        {filter === "active" ? (
          <>
            Start with{" "}
            <Link href="/compose" className="underline">
              Compose
            </Link>{" "}
            for a manual draft, or check{" "}
            <Link href="/discover" className="underline">
              Discover
            </Link>{" "}
            for viral content to react to. The autonomous cron also fires every
            4 hours.
          </>
        ) : (
          <>Try the active filter or another tab above.</>
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
