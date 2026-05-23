import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { generations, posts, type Post } from "@/db/schema";
import { extractMemoriesFromPost } from "./memory-extract";
import { writeTrace } from "./trace";
import { postThread, postTweet } from "./x";

export type ShipPostResult =
  | { ok: true; posts: Post[]; xTweetIds: string[] }
  | { ok: false; status: number; error: string; message?: string };

export async function shipPostById(postId: string): Promise<ShipPostResult> {
  const rootRows = await db.select().from(posts).where(eq(posts.id, postId)).limit(1);
  const root = rootRows[0];
  if (!root) return { ok: false, status: 404, error: "not found" };

  if (root.parentPostId !== null) {
    return {
      ok: false,
      status: 400,
      error:
        "this is a thread child — post the thread root instead (it will chain replies)",
    };
  }

  if (root.status !== "draft" && root.status !== "approved") {
    return {
      ok: false,
      status: 400,
      error: `cannot post in status '${root.status}'`,
    };
  }

  await writeTrace({
    generationId: root.generationId,
    agent: "poster",
    eventType: "start",
    payload: { postId, contentType: root.contentType },
  });

  try {
    let postedRows: Post[] = [];
    let xIds: string[] = [];

    if (root.contentType === "thread") {
      const children: Post[] = await db
        .select()
        .from(posts)
        .where(eq(posts.parentPostId, root.id))
        .orderBy(asc(posts.threadPosition));

      const allRows = [root, ...children];
      const texts = allRows.map((r) => r.text);
      const results = await postThread(texts);

      for (let i = 0; i < allRows.length; i++) {
        const row = allRows[i];
        const tweet = results[i];
        if (!row || !tweet) continue;
        const [updated]: Post[] = await db
          .update(posts)
          .set({
            status: "posted",
            xTweetId: tweet.id,
            postedAt: new Date(),
            updatedAt: new Date(),
          })
          .where(eq(posts.id, row.id))
          .returning();
        if (updated) postedRows.push(updated);
      }
      xIds = results.map((r) => r.id);
    } else {
      const tweet = await postTweet(root.text, {
        quoteTweetId: root.quoteTweetId ?? undefined,
      });
      const [updated]: Post[] = await db
        .update(posts)
        .set({
          status: "posted",
          xTweetId: tweet.id,
          postedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(posts.id, root.id))
        .returning();
      if (updated) postedRows = [updated];
      xIds = [tweet.id];
    }

    await writeTrace({
      generationId: root.generationId,
      agent: "poster",
      eventType: "complete",
      payload: { postId, xTweetIds: xIds, count: postedRows.length },
    });

    // Fire-and-forget memory extraction. We don't await — successful posting
    // shouldn't block on extraction latency, and extraction is idempotent
    // (canonical-slot dedupe). Errors are logged inside the extractor.
    void runPostMemoryExtraction(root.id, root.text, root.generationId);

    return { ok: true, posts: postedRows, xTweetIds: xIds };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await db
      .update(posts)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(posts.id, postId));
    await writeTrace({
      generationId: root.generationId,
      agent: "poster",
      eventType: "error",
      payload: { postId, message },
    });
    return { ok: false, status: 500, error: "post failed", message };
  }
}

async function runPostMemoryExtraction(
  postId: string,
  text: string,
  generationId: string | null,
): Promise<void> {
  try {
    let topic: string | null = null;
    if (generationId) {
      const gen = await db
        .select({ topic: generations.topic })
        .from(generations)
        .where(eq(generations.id, generationId))
        .limit(1);
      topic = gen[0]?.topic ?? null;
    }
    const result = await extractMemoriesFromPost({
      postText: text,
      topic,
      outcome: "posted",
      sourceId: postId,
    });
    await writeTrace({
      generationId,
      agent: "memory-extract",
      eventType: "complete",
      payload: {
        postId,
        outcome: "posted",
        extracted: result.extracted.length,
        recorded: result.recorded,
      },
      model: result.model,
      costUsd: result.costUsd.toString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    await writeTrace({
      generationId,
      agent: "memory-extract",
      eventType: "error",
      payload: { postId, message },
    });
  }
}
