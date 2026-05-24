import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import {
  generations,
  POST_STATUS,
  posts,
  type Post,
  type PostStatus,
} from "@/db/schema";
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

type Filter = "active" | "all" | PostStatus;

const ACTIVE_STATUSES: PostStatus[] = ["draft", "approved", "scheduled", "failed"];

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
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">
            Review, skip, or ship drafts. Threads post as chained replies.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ResetQueueButton activeCount={counts.active} />
          <Badge variant="outline" className="font-mono">
            slice 3a
          </Badge>
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
