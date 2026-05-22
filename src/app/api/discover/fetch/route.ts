import { INFLUENCERS } from "@/config/influencers";
import { db } from "@/db/client";
import { viralPosts } from "@/db/schema";
import { writeTrace } from "@/lib/trace";
import { userByUsername, userTimeline } from "@/lib/x";

type FetchResult = {
  influencersTracked: number;
  influencersResolved: number;
  tweetsFetched: number;
  tweetsCaptured: number;
  apiCallsApprox: number;
  errors: string[];
  elapsedMs: number;
};

export async function POST() {
  const startedAt = Date.now();
  const result: FetchResult = {
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
    payload: { influencers: INFLUENCERS.length },
  });

  for (const inf of INFLUENCERS) {
    try {
      const user = await userByUsername(inf.username);
      result.apiCallsApprox += 1;
      if (!user) {
        result.errors.push(`@${inf.username}: not found`);
        continue;
      }
      result.influencersResolved += 1;

      const tweets = await userTimeline(user.id, { max: 10 });
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
    payload: { ...result },
  });

  return Response.json(result);
}
