import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { db } from "@/db/client";
import { posts } from "@/db/schema";

export const dynamic = "force-dynamic";

type ScheduledPost = {
  id: string;
  text: string;
  contentType: string;
  scheduledFor: Date;
  createdAt: Date;
  threadCount: number;
};

async function loadScheduled(): Promise<ScheduledPost[]> {
  const now = new Date();
  const rows = await db
    .select({
      id: posts.id,
      text: posts.text,
      contentType: posts.contentType,
      scheduledFor: posts.scheduledFor,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(
      and(
        eq(posts.status, "approved"),
        isNull(posts.parentPostId),
        gt(posts.scheduledFor, now),
      ),
    )
    .orderBy(asc(posts.scheduledFor));

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

  return rows
    .filter((r): r is typeof r & { scheduledFor: Date } => r.scheduledFor !== null)
    .map((r) => ({
      ...r,
      scheduledFor: r.scheduledFor,
      threadCount: r.contentType === "thread" ? (byParent.get(r.id) ?? 0) + 1 : 0,
    }));
}

function fmtRelative(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms < 0) return "overdue";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtTime(d: Date): string {
  return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

function groupByDate(items: ScheduledPost[]): Map<string, ScheduledPost[]> {
  const groups = new Map<string, ScheduledPost[]>();
  for (const item of items) {
    const key = item.scheduledFor.toISOString().slice(0, 10);
    const arr = groups.get(key) ?? [];
    arr.push(item);
    groups.set(key, arr);
  }
  return groups;
}

export default async function SchedulePage() {
  const scheduled = await loadScheduled();
  const grouped = groupByDate(scheduled);

  return (
    <div className="flex flex-col gap-6 p-8">
      <header className="flex items-baseline justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Schedule</h1>
          <p className="text-sm text-muted-foreground">
            {scheduled.length === 0
              ? "No posts scheduled. Schedule from the queue."
              : `${scheduled.length} post${scheduled.length !== 1 ? "s" : ""} scheduled.`}
          </p>
        </div>
        <Badge variant="outline" className="font-mono">
          slice 3
        </Badge>
      </header>

      {scheduled.length === 0 ? (
        <div className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
          <p className="text-sm font-medium">Nothing scheduled.</p>
          <p className="text-sm text-muted-foreground">
            Head to the{" "}
            <Link href="/queue" className="underline">
              Queue
            </Link>{" "}
            and schedule a post.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-6">
          {[...grouped.entries()].map(([dateKey, items]) => (
            <div key={dateKey} className="flex flex-col gap-2">
              <h2 className="font-mono text-xs font-semibold text-muted-foreground">
                {fmtDate(items[0]!.scheduledFor)}
              </h2>
              <div className="flex flex-col gap-2">
                {items.map((post) => (
                  <article
                    key={post.id}
                    className="flex items-start gap-4 rounded-lg border bg-card p-4"
                  >
                    <div className="flex flex-col items-center gap-1 pt-0.5">
                      <span className="font-mono text-sm font-semibold">
                        {fmtTime(post.scheduledFor)}
                      </span>
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {fmtRelative(post.scheduledFor)}
                      </span>
                    </div>
                    <div className="flex flex-1 flex-col gap-1">
                      <div className="flex items-center gap-2 text-xs">
                        <Badge variant="outline" className="font-mono">
                          {post.contentType === "thread"
                            ? `thread · ${post.threadCount}`
                            : "single"}
                        </Badge>
                        <span className="font-mono text-muted-foreground">
                          {post.text.length} chars
                        </span>
                      </div>
                      <p className="whitespace-pre-wrap text-sm leading-relaxed">
                        {post.text.length > 280
                          ? `${post.text.slice(0, 277)}...`
                          : post.text}
                      </p>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
