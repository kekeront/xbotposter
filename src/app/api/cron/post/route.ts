import { and, eq, isNull, lte } from "drizzle-orm";
import { db } from "@/db/client";
import { posts } from "@/db/schema";
import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";
import { shipPostById } from "@/lib/poster";
import { checkSpendCap, spendCapResponse } from "@/lib/spend-cap";
import { writeTrace } from "@/lib/trace";

const BATCH_LIMIT = 5; // per cron tick — avoid X rate limits

// Long-running autonomous job — pin the function budget so a slow run isn't
// killed at the platform default (which would orphan in-flight work).
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorized();

  const verdict = await checkSpendCap();
  if (!verdict.allow) return spendCapResponse(verdict);

  const dueRows = await db
    .select({ id: posts.id })
    .from(posts)
    .where(
      and(
        eq(posts.status, "approved"),
        isNull(posts.parentPostId),
        lte(posts.scheduledFor, new Date()),
      ),
    )
    .limit(BATCH_LIMIT);

  await writeTrace({
    generationId: null,
    agent: "cron-post",
    eventType: "start",
    payload: { dueCount: dueRows.length },
  });

  const results: Array<{
    postId: string;
    ok: boolean;
    error?: string;
    xTweetIds?: string[];
  }> = [];

  for (const { id } of dueRows) {
    const r = await shipPostById(id);
    if (r.ok) {
      results.push({ postId: id, ok: true, xTweetIds: r.xTweetIds });
    } else {
      results.push({ postId: id, ok: false, error: r.error });
    }
  }

  await writeTrace({
    generationId: null,
    agent: "cron-post",
    eventType: "complete",
    payload: {
      processed: results.length,
      succeeded: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    },
  });

  return Response.json({ processed: results.length, results });
}
