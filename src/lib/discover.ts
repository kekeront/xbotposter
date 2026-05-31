import "server-only";
import { and, isNotNull, sql } from "drizzle-orm";
import { INFLUENCERS } from "@/config/influencers";
import type { Influencer } from "@/config/influencers";
import { db } from "@/db/client";
import { viralPosts } from "@/db/schema";
import { writeTrace } from "./trace";
import { userByUsername, userTimeline } from "./x";

async function loadLatestSeenByAuthor(): Promise<Map<string, string>> {
  const rows = await db
    .select({
      author: viralPosts.author,
      maxId: sql<string>`max(${viralPosts.xTweetId}::numeric)::text`,
    })
    .from(viralPosts)
    .where(
      and(isNotNull(viralPosts.author), isNotNull(viralPosts.xTweetId)),
    )
    .groupBy(viralPosts.author);
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.author && r.maxId) map.set(r.author, r.maxId);
  }
  return map;
}

// Per-call hard limit so a hung X API request can't lock the whole run.
const X_CALL_TIMEOUT_MS = 8_000;

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_resolve, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);
}

export type DiscoverFetchResult = {
  influencersTracked: number;
  influencersResolved: number;
  tweetsFetched: number;
  tweetsCaptured: number;
  apiCallsApprox: number;
  errors: string[];
  elapsedMs: number;
};

export async function runDiscoverFetch(opts?: {
  source?: "manual" | "cron";
  userId?: string;
  /** Tracked accounts to fetch timelines for. When omitted or empty, falls back
   *  to the curated INFLUENCERS list from src/config/influencers.ts. */
  accounts?: Influencer[];
}): Promise<DiscoverFetchResult> {
  const startedAt = Date.now();
  const source = opts?.source ?? "manual";

  // Use caller-supplied accounts when present and non-empty; fall back to the
  // curated INFLUENCERS list so existing behavior is preserved.
  const targets: Influencer[] =
    opts?.accounts && opts.accounts.length > 0 ? opts.accounts : INFLUENCERS;

  const result: DiscoverFetchResult = {
    influencersTracked: targets.length,
    influencersResolved: 0,
    tweetsFetched: 0,
    tweetsCaptured: 0,
    apiCallsApprox: 0,
    errors: [],
    elapsedMs: 0,
  };

  const lastSeenByAuthor = await loadLatestSeenByAuthor();

  await writeTrace({
    generationId: null,
    agent: "discover",
    eventType: "start",
    payload: {
      influencers: targets.length,
      source,
      usingTrackedAccounts: opts?.accounts != null && opts.accounts.length > 0,
      authorsWithSinceId: lastSeenByAuthor.size,
    },
  });

  for (const inf of targets) {
    try {
      // Skip userByUsername entirely if id is pre-resolved in config —
      // saves ~$0.005-0.010 per influencer per fetch run.
      let user: { id: string; username: string };
      if (inf.id) {
        user = { id: inf.id, username: inf.username };
      } else {
        const resolved = await withTimeout(
          userByUsername(inf.username),
          X_CALL_TIMEOUT_MS,
          `userByUsername(@${inf.username})`,
        );
        result.apiCallsApprox += 1;
        if (!resolved) {
          result.errors.push(`@${inf.username}: not found`);
          continue;
        }
        user = resolved;
      }
      result.influencersResolved += 1;

      const sinceId = lastSeenByAuthor.get(inf.username);
      const tweets = await withTimeout(
        userTimeline(user.id, { max: 5, sinceId }),
        X_CALL_TIMEOUT_MS,
        `userTimeline(@${inf.username})`,
      );
      result.apiCallsApprox += 1;
      result.tweetsFetched += tweets.length;

      for (const t of tweets) {
        if (t.isReply || t.isRetweet) continue;

        try {
          await db
            .insert(viralPosts)
            .values({
              userId: opts?.userId ?? null,
              xTweetId: t.id,
              xUrl: `https://x.com/${user.username}/status/${t.id}`,
              author: user.username,
              text: t.text,
              engagement: t.metrics,
            })
            .onConflictDoUpdate({
              target: viralPosts.xTweetId,
              set: {
                engagement: t.metrics,
                text: t.text,
              },
            });
          result.tweetsCaptured += 1;
        } catch (err) {
          result.errors.push(
            `@${inf.username} ${t.id}: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }
    } catch (err) {
      result.errors.push(
        `@${inf.username}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  result.elapsedMs = Date.now() - startedAt;

  await writeTrace({
    generationId: null,
    agent: "discover",
    eventType: result.errors.length > 0 ? "complete_with_errors" : "complete",
    payload: { ...result, source },
  });

  return result;
}
