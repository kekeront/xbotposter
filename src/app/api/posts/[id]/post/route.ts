import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { posts, type Post } from "@/db/schema";
import { writeTrace } from "@/lib/trace";
import { postThread, postTweet } from "@/lib/x";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteContext) {
  const { id } = await params;

  const rootRows = await db.select().from(posts).where(eq(posts.id, id)).limit(1);
  const root = rootRows[0];
  if (!root) {
    return Response.json({ error: "not found" }, { status: 404 });
  }

  if (root.parentPostId !== null) {
    return Response.json(
      {
        error:
          "this is a thread child — post the thread root instead (it will chain replies)",
      },
      { status: 400 },
    );
  }

  if (root.status !== "draft" && root.status !== "approved") {
    return Response.json(
      { error: `cannot post in status '${root.status}'` },
      { status: 400 },
    );
  }

  await writeTrace({
    generationId: root.generationId,
    agent: "poster",
    eventType: "start",
    payload: { postId: id, contentType: root.contentType },
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
      const tweet = await postTweet(root.text);
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
      payload: { postId: id, xTweetIds: xIds, count: postedRows.length },
    });

    return Response.json({ ok: true, posts: postedRows, xTweetIds: xIds });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";

    await db
      .update(posts)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(posts.id, id));

    await writeTrace({
      generationId: root.generationId,
      agent: "poster",
      eventType: "error",
      payload: { postId: id, message },
    });

    return Response.json(
      { error: "post failed", message, postId: id },
      { status: 500 },
    );
  }
}
