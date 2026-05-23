import {
  and,
  asc,
  count,
  eq,
  gte,
  gt,
  inArray,
  isNull,
} from "drizzle-orm";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { loadBilling, type SpendBucket } from "@/lib/billing";

type Stats = {
  postedLast7d: number;
  inQueue: number;
  nextScheduledFor: Date | null;
};

async function loadStats(): Promise<Stats | null> {
  try {
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const now = new Date();

    const [postedRow, queueRow, nextRow] = await Promise.all([
      db
        .select({ c: count() })
        .from(posts)
        .where(and(eq(posts.status, "posted"), gte(posts.postedAt, sevenDaysAgo))),
      db
        .select({ c: count() })
        .from(posts)
        .where(
          and(isNull(posts.parentPostId), inArray(posts.status, ["draft", "approved"])),
        ),
      db
        .select({ scheduledFor: posts.scheduledFor })
        .from(posts)
        .where(
          and(
            eq(posts.status, "approved"),
            isNull(posts.parentPostId),
            gt(posts.scheduledFor, now),
          ),
        )
        .orderBy(asc(posts.scheduledFor))
        .limit(1),
    ]);

    return {
      postedLast7d: postedRow[0]?.c ?? 0,
      inQueue: queueRow[0]?.c ?? 0,
      nextScheduledFor: nextRow[0]?.scheduledFor ?? null,
    };
  } catch {
    return null;
  }
}

function fmtRelativeFuture(d: Date): string {
  const ms = d.getTime() - Date.now();
  if (ms < 0) return "overdue";
  const m = Math.floor(ms / 60000);
  if (m < 60) return `in ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `in ${h}h ${m % 60}m`;
  return `in ${Math.floor(h / 24)}d ${h % 24}h`;
}

function fmtCents(usd: number): string {
  if (usd < 0.01) return "<¢1";
  if (usd < 1) return `${Math.round(usd * 100)}¢`;
  return `$${usd.toFixed(2)}`;
}

// Color hint: green if under 10¢/day, amber 10¢-$1, red over $1.
function spendColor(usd: number): string {
  if (usd < 0.1) return "text-emerald-700 dark:text-emerald-400";
  if (usd < 1) return "text-amber-700 dark:text-amber-400";
  return "text-destructive";
}

export async function CadenceStrip() {
  const [stats, billing] = await Promise.all([loadStats(), loadBilling()]);
  if (!stats) return null;

  return (
    <div className="flex flex-wrap items-center gap-3 border-b bg-muted/30 px-8 py-2 font-mono text-xs text-muted-foreground">
      <span>
        <span className="font-semibold text-foreground">
          {stats.postedLast7d}
        </span>{" "}
        posted last 7d
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span>
        <span className="font-semibold text-foreground">{stats.inQueue}</span>{" "}
        in queue
      </span>
      <span className="text-muted-foreground/40">·</span>
      <span>
        {stats.nextScheduledFor ? (
          <>
            next ships{" "}
            <span className="font-semibold text-foreground">
              {fmtRelativeFuture(stats.nextScheduledFor)}
            </span>
          </>
        ) : (
          <span>nothing scheduled</span>
        )}
      </span>

      {billing ? (
        <>
          <span className="ml-auto text-muted-foreground/40">·</span>
          <BillingPill label="today" bucket={billing.today} />
          <span className="text-muted-foreground/40">·</span>
          <BillingPill label="7d" bucket={billing.last7d} />
          <span className="text-muted-foreground/40">·</span>
          <BillingPill label="month" bucket={billing.thisMonth} />
        </>
      ) : null}
    </div>
  );
}

function BillingPill({ label, bucket }: { label: string; bucket: SpendBucket }) {
  const tooltip =
    `${label}: OpenAI ${fmtCents(bucket.openaiUsd)} · X est ${fmtCents(bucket.xUsd)}\n` +
    `${bucket.breakdown.generationCount} gens · ${bucket.breakdown.postedTweetCount} posts · ` +
    `${bucket.breakdown.discoverRunCount} discover runs · ${bucket.breakdown.discoverResourcesTotal} tweets fetched`;
  return (
    <span title={tooltip}>
      <span className="text-muted-foreground">{label}:</span>{" "}
      <span className={`font-semibold ${spendColor(bucket.totalUsd)}`}>
        {fmtCents(bucket.totalUsd)}
      </span>
    </span>
  );
}
