import { desc, isNull, sql } from "drizzle-orm";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { posts, type Post } from "@/db/schema";
import { PostRow } from "./post-row";

export const dynamic = "force-dynamic";

type Loaded =
  | { ok: true; rows: Array<Post & { threadCount: number }> }
  | { ok: false; error: string };

async function loadPosts(): Promise<Loaded> {
  try {
    const rows = await db
      .select()
      .from(posts)
      .where(isNull(posts.parentPostId))
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
      rows: rows.map((r) => ({
        ...r,
        threadCount:
          r.contentType === "thread" ? (byParent.get(r.id) ?? 0) + 1 : 0,
      })),
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "unknown DB error",
    };
  }
}

export default async function QueuePage() {
  const result = await loadPosts();

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Queue</h1>
          <p className="text-sm text-muted-foreground">
            Review, skip, or ship drafts. Threads post as chained replies.
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          slice 2a
        </Badge>
      </header>

      {!result.ok ? (
        <DbErrorState message={result.error} />
      ) : result.rows.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="flex flex-col gap-3">
          {result.rows.map((row) => (
            <PostRow
              key={row.id}
              post={row}
              threadCount={row.threadCount || undefined}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <p className="text-sm font-medium">No drafts yet.</p>
      <p className="text-sm text-muted-foreground">
        Head to <a href="/compose" className="underline">Compose</a> and draft
        something.
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
