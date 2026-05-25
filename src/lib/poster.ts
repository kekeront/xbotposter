import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { posts, type Post } from "@/db/schema";
import { recordMemoryTurn } from "./memory-bridge";
import { writeTrace } from "./trace";
import { postThread, postTweet } from "./x";

export type ShipPostResult =
  | { ok: true; posts: Post[]; xTweetIds: string[] }
  | { ok: false; status: number; error: string; message?: string };

export async function shipPostById(
  postId: string,
  opts?: { userId?: string },
): Promise<ShipPostResult> {
  const whereClause = opts?.userId
    ? and(eq(posts.id, postId), eq(posts.userId, opts.userId))
    : eq(posts.id, postId);
  const rootRows = await db.select().from(posts).where(whereClause).limit(1);
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
      const results = await postThread(texts, { userId: opts?.userId });

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
        userId: opts?.userId,
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

    // Record this ship as a memory turn. No-op if MEMORY_ENABLED is off.
    // Hard-timeouted via bridge; failures here never block post return.
    await recordMemoryTurn({
      sessionId: `post:${root.id}`,
      messages: postedRows.map((p) => ({
        role: "assistant" as const,
        content: p.text,
      })),
      metadata: {
        kind: "shipped_post",
        postId: root.id,
        contentType: root.contentType,
        xTweetIds: xIds,
        generationId: root.generationId,
      },
    });

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
