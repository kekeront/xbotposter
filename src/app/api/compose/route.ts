import { eq } from "drizzle-orm";
import { z } from "zod";
import { review } from "@/agents/editor";
import { draft } from "@/agents/writer";
import { db } from "@/db/client";
import {
  type ContentType,
  fingerprints,
  generations,
  posts,
  type Post,
} from "@/db/schema";
import { writeTrace } from "@/lib/trace";

const ComposeRequest = z.object({
  topic: z.string().min(1).max(2000),
  contentType: z.enum(["single", "thread"]).default("single"),
  mode: z.enum(["ai", "manual"]).default("ai"),
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

async function insertPostChain(
  generationId: string,
  contentType: ContentType,
  texts: string[],
): Promise<Post[]> {
  const out: Post[] = [];
  let parentId: string | null = null;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;
    const inserted: Post[] = await db
      .insert(posts)
      .values({
        generationId,
        parentPostId: parentId,
        threadPosition: contentType === "thread" ? i + 1 : null,
        contentType,
        text,
        status: "draft",
      })
      .returning();
    const row = inserted[0];
    if (!row) continue;
    out.push(row);
    if (i === 0 && contentType === "thread") parentId = row.id;
  }
  return out;
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
  const { topic, contentType, mode } = parsed.data;

  const [generation] = await db
    .insert(generations)
    .values({
      topic,
      inputMeta: { contentType, mode },
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
    payload: { contentType, mode, length: topic.length },
  });

  try {
    if (mode === "manual") {
      const texts =
        contentType === "thread"
          ? topic
              .split(/\n?---\n?/)
              .map((t) => t.trim())
              .filter(Boolean)
          : [topic.trim()];

      const createdPosts = await insertPostChain(
        generation.id,
        contentType,
        texts,
      );

      await db
        .update(generations)
        .set({
          status: "succeeded",
          model: "manual",
          tokensIn: 0,
          tokensOut: 0,
          costUsd: "0",
          completedAt: new Date(),
        })
        .where(eq(generations.id, generation.id));

      await writeTrace({
        generationId: generation.id,
        agent: "compose",
        eventType: "complete",
        payload: { postCount: createdPosts.length, mode: "manual" },
      });

      return Response.json(
        {
          generation: {
            id: generation.id,
            status: "succeeded" as const,
            model: "manual",
            tokensIn: 0,
            tokensOut: 0,
            costUsd: 0,
          },
          posts: createdPosts,
        },
        { status: 201 },
      );
    }

    // mode === "ai" — two-stage pipeline: writer → editor
    const referenceTweets = await loadDefaultReferenceTweets();

    await writeTrace({
      generationId: generation.id,
      agent: "writer",
      eventType: "start",
      payload: { referenceTweetCount: referenceTweets.length },
    });

    const writerResult = await draft({ topic, contentType, referenceTweets });

    await writeTrace({
      generationId: generation.id,
      agent: "writer",
      eventType: "complete",
      payload: { variants: writerResult.texts.length },
      model: writerResult.model,
      tokensIn: writerResult.tokensIn,
      tokensOut: writerResult.tokensOut,
      costUsd: writerResult.costUsd.toString(),
    });

    await writeTrace({
      generationId: generation.id,
      agent: "editor",
      eventType: "start",
      payload: { draftCount: writerResult.texts.length },
    });

    const editorResult = await review({
      topic,
      drafts: writerResult.texts,
      contentType,
      referenceTweets,
    });

    await writeTrace({
      generationId: generation.id,
      agent: "editor",
      eventType: editorResult.changed ? "complete_with_changes" : "complete_no_changes",
      payload: {
        issues: editorResult.issuesFound,
        changed: editorResult.changed,
      },
      model: editorResult.model,
      tokensIn: editorResult.tokensIn,
      tokensOut: editorResult.tokensOut,
      costUsd: editorResult.costUsd.toString(),
    });

    const totalTokensIn = writerResult.tokensIn + editorResult.tokensIn;
    const totalTokensOut = writerResult.tokensOut + editorResult.tokensOut;
    const totalCost = writerResult.costUsd + editorResult.costUsd;

    await db
      .update(generations)
      .set({
        status: "succeeded",
        model: `${writerResult.model} + ${editorResult.model}`,
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        costUsd: totalCost.toString(),
        completedAt: new Date(),
      })
      .where(eq(generations.id, generation.id));

    const finalTexts = editorResult.texts;
    const createdPosts = await insertPostChain(
      generation.id,
      contentType,
      finalTexts,
    );

    await writeTrace({
      generationId: generation.id,
      agent: "compose",
      eventType: "complete",
      payload: {
        postCount: createdPosts.length,
        mode: "ai",
        editorChanged: editorResult.changed,
        editorIssues: editorResult.issuesFound,
      },
    });

    return Response.json(
      {
        generation: {
          id: generation.id,
          status: "succeeded" as const,
          model: `${writerResult.model} + ${editorResult.model}`,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          costUsd: totalCost,
        },
        editor: {
          changed: editorResult.changed,
          issuesFound: editorResult.issuesFound,
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
