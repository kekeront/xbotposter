import "server-only";
import { and, count, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { generations, posts, traces } from "@/db/schema";

// Rough X PPU rates from docs (2026-05). Used for estimates only — actual
// billing lives in the X dev console.
const X_DISCOVER_RUN_AVG = 0.25; // post-optimization: 5 inf × 5 tweets cached IDs
const X_TWEET_POST = 0.015; // POST /2/tweets without URL

export type SpendBucket = {
  openaiUsd: number;
  xUsd: number;
  totalUsd: number;
  breakdown: {
    generationCount: number;
    standaloneTraceCount: number;
    postedTweetCount: number;
    discoverRunCount: number;
  };
};

async function spendSince(since: Date | null): Promise<SpendBucket> {
  const sinceFilter = since ? since : new Date(0);

  const [genAgg, traceAgg, postedAgg, discoverAgg] = await Promise.all([
    db
      .select({
        sum: sql<string>`coalesce(sum(${generations.costUsd}), 0)`,
        c: count(),
      })
      .from(generations)
      .where(gt(generations.createdAt, sinceFilter)),
    db
      .select({
        sum: sql<string>`coalesce(sum(${traces.costUsd}), 0)`,
        c: count(),
      })
      .from(traces)
      .where(and(gt(traces.ts, sinceFilter), isNull(traces.generationId))),
    db
      .select({ c: count() })
      .from(posts)
      .where(
        and(
          gt(posts.postedAt, sinceFilter),
          eq(posts.status, "posted"),
          isNotNull(posts.postedAt),
        ),
      ),
    db
      .select({ c: count() })
      .from(traces)
      .where(
        and(
          gt(traces.ts, sinceFilter),
          eq(traces.agent, "discover"),
          eq(traces.eventType, "complete"),
        ),
      ),
  ]);

  const openaiFromGenerations = Number(genAgg[0]?.sum ?? "0");
  const openaiFromStandalone = Number(traceAgg[0]?.sum ?? "0");
  const openaiUsd = openaiFromGenerations + openaiFromStandalone;

  const postedTweetCount = postedAgg[0]?.c ?? 0;
  const discoverRunCount = discoverAgg[0]?.c ?? 0;
  const xUsd =
    postedTweetCount * X_TWEET_POST + discoverRunCount * X_DISCOVER_RUN_AVG;

  return {
    openaiUsd,
    xUsd,
    totalUsd: openaiUsd + xUsd,
    breakdown: {
      generationCount: genAgg[0]?.c ?? 0,
      standaloneTraceCount: traceAgg[0]?.c ?? 0,
      postedTweetCount,
      discoverRunCount,
    },
  };
}

export type BillingSnapshot = {
  today: SpendBucket;
  last7d: SpendBucket;
  thisMonth: SpendBucket;
  allTime: SpendBucket;
};

export async function loadBilling(): Promise<BillingSnapshot | null> {
  try {
    const now = new Date();
    const startOfToday = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
    );
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000);
    const startOfMonth = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1),
    );

    const [today, last7d, thisMonth, allTime] = await Promise.all([
      spendSince(startOfToday),
      spendSince(sevenDaysAgo),
      spendSince(startOfMonth),
      spendSince(null),
    ]);

    return { today, last7d, thisMonth, allTime };
  } catch {
    return null;
  }
}
