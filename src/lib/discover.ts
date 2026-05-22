import "server-only";
import { INFLUENCERS } from "@/config/influencers";
import { db } from "@/db/client";
import { viralPosts } from "@/db/schema";
import { writeTrace } from "./trace";
import { userByUsername, userTimeline } from "./x";

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
}): Promise<DiscoverFetchResult> {
  const startedAt = Date.now();
  const source = opts?.source ?? "manual";
  const result: DiscoverFetchResult = {
    influencersTracked: INFLUENCERS.length,
    influencersResolved: 0,
    tweetsFetched: 0,
    tweetsCaptured: 0,
    apiCallsApprox: 0,
    errors: [],
    elapsedMs: 0,
  };

  await writeTrace({
    generationId: null,
    agent: "discover",
    eventType: "start",
    payload: { influencers: INFLUENCERS.length, source },
  });

  for (const inf of INFLUENCERS) {
    try {
      const user = await withTimeout(
        userByUsername(inf.username),
        X_CALL_TIMEOUT_MS,
        `userByUsername(@${inf.username})`,
      );
      result.apiCallsApprox += 1;
      if (!user) {
        result.errors.push(`@${inf.username}: not found`);
        continue;
      }
      result.influencersResolved += 1;

      const tweets = await withTimeout(
        userTimeline(user.id, { max: 10 }),
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
