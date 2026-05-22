import { eq } from "drizzle-orm";
import { z } from "zod";
import { draft } from "@/agents/writer";
import { db } from "@/db/client";
import { fingerprints, generations, posts, type Post } from "@/db/schema";
import { writeTrace } from "@/lib/trace";

const ComposeRequest = z.object({
  topic: z.string().min(1).max(2000),
  contentType: z.enum(["single", "thread"]).default("single"),
});

type FingerprintProfile = {
  referenceTweets?: string[];
};

async function loadDefaultReferenceTweets(): Promise<string[]> {
  const rows = await db
    .select()
    .from(fingerprints)
    .where(eq(fingerprints.name, "default"))
    .limit(1);
  const row = rows[0];
  if (!row) return [];
  const profile = row.profile as FingerprintProfile;
  return profile.referenceTweets ?? [];
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = ComposeRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { topic, contentType } = parsed.data;

  const [generation] = await db
    .insert(generations)
    .values({
      topic,
      inputMeta: { contentType },
      status: "running",
    })
    .returning();

  if (!generation) {
    return Response.json(
      { error: "failed to create generation row" },
      { status: 500 },
    );
  }

  await writeTrace({
    generationId: generation.id,
    agent: "compose",
    eventType: "start",
    payload: { topic, contentType },
  });

  try {
    const referenceTweets = await loadDefaultReferenceTweets();

    await writeTrace({
      generationId: generation.id,
      agent: "writer",
      eventType: "start",
      payload: { referenceTweetCount: referenceTweets.length },
    });

    const result = await draft({ topic, contentType, referenceTweets });

    await writeTrace({
      generationId: generation.id,
      agent: "writer",
      eventType: "complete",
      payload: { variants: result.texts.length },
      model: result.model,
      tokensIn: result.tokensIn,
      tokensOut: result.tokensOut,
      costUsd: result.costUsd.toString(),
    });

    await db
      .update(generations)
      .set({
        status: "succeeded",
        model: result.model,
        tokensIn: result.tokensIn,
        tokensOut: result.tokensOut,
        costUsd: result.costUsd.toString(),
        completedAt: new Date(),
      })
      .where(eq(generations.id, generation.id));

    const createdPosts: Post[] = [];
    let parentId: string | null = null;

    for (let i = 0; i < result.texts.length; i++) {
      const text = result.texts[i];
      if (!text) continue;
      const inserted: Post[] = await db
        .insert(posts)
        .values({
          generationId: generation.id,
          parentPostId: parentId,
          threadPosition: contentType === "thread" ? i + 1 : null,
          contentType,
          text,
          status: "draft",
        })
        .returning();
      const row = inserted[0];
      if (!row) continue;
      createdPosts.push(row);
      if (i === 0 && contentType === "thread") parentId = row.id;
    }

    await writeTrace({
      generationId: generation.id,
      agent: "compose",
      eventType: "complete",
      payload: { postCount: createdPosts.length },
    });

    return Response.json(
      {
        generation: {
          id: generation.id,
          status: "succeeded" as const,
          model: result.model,
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costUsd: result.costUsd,
        },
        posts: createdPosts,
      },
      { status: 201 },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";

    await db
      .update(generations)
      .set({
        status: "failed",
        error: message,
        completedAt: new Date(),
      })
      .where(eq(generations.id, generation.id));

    await writeTrace({
      generationId: generation.id,
      agent: "compose",
      eventType: "error",
      payload: { message },
    });

    return Response.json(
      { error: "generation failed", message, generationId: generation.id },
      { status: 500 },
    );
  }
}
