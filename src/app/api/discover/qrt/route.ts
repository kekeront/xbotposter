import { eq } from "drizzle-orm";
import { z } from "zod";
import { review } from "@/agents/editor";
import { draft as qrtDraft } from "@/agents/qrt";
import { check as guardCheck } from "@/agents/topic-guard";
import { db } from "@/db/client";
import { generations, posts, viralPosts, type Post } from "@/db/schema";
import { writeTrace } from "@/lib/trace";
import { loadDefaultVoice } from "@/lib/voice-load";

const QrtRequest = z.object({
  viralPostId: z.string().uuid(),
  userAngle: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = QrtRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { viralPostId, userAngle } = parsed.data;

  const viralRows = await db
    .select()
    .from(viralPosts)
    .where(eq(viralPosts.id, viralPostId))
    .limit(1);
  const viral = viralRows[0];
  if (!viral) {
    return Response.json({ error: "viral post not found" }, { status: 404 });
  }
  if (!viral.xTweetId) {
    return Response.json(
      { error: "viral post has no x_tweet_id; cannot QRT" },
      { status: 400 },
    );
  }

  const author = viral.author ?? "unknown";

  // Topic safety gate — fail-closed on politics / tragedy / conspiracy / etc.
  const guard = await guardCheck({ text: viral.text, author });
  await writeTrace({
    generationId: null,
    agent: "topic-guard",
    eventType: guard.safe ? "safe" : "blocked",
    payload: {
      viralPostId: viral.id,
      viralAuthor: author,
      category: guard.category,
      reason: guard.reason,
      mode: "qrt",
    },
    model: guard.model,
    tokensIn: guard.tokensIn,
    tokensOut: guard.tokensOut,
    costUsd: guard.costUsd.toString(),
  });

  if (!guard.safe) {
    return Response.json(
      {
        blocked: true,
        category: guard.category,
        reason: guard.reason,
        viralAuthor: author,
      },
      { status: 200 },
    );
  }

  const [generation] = await db
    .insert(generations)
    .values({
      topic: `qrt on @${author}: ${viral.text.slice(0, 100)}`,
      inputMeta: {
        contentType: "single",
        mode: "qrt",
        viralPostId: viral.id,
        viralAuthor: author,
        viralXTweetId: viral.xTweetId,
        viralXUrl: viral.xUrl,
        userAngle: userAngle ?? null,
      },
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
    agent: "qrt",
    eventType: "start",
    payload: { viralAuthor: author, hasAngle: !!userAngle },
  });

  try {
    const voice = await loadDefaultVoice();

    const writerResult = await qrtDraft({
      viralText: viral.text,
      viralAuthor: author,
      userAngle: userAngle ?? null,
      referenceTweets: voice.referenceTweets,
      fingerprintBlock: voice.fingerprintBlock,
    });

    await writeTrace({
      generationId: generation.id,
      agent: "qrt",
      eventType: "complete",
      payload: { length: writerResult.text.length },
      model: writerResult.model,
      tokensIn: writerResult.tokensIn,
      tokensOut: writerResult.tokensOut,
      costUsd: writerResult.costUsd.toString(),
    });

    const editorResult = await review({
      topic: userAngle
        ? `${userAngle} (qrt on @${author}: ${viral.text})`
        : `Quote retweeting @${author}: ${viral.text}`,
      drafts: [writerResult.text],
      contentType: "single",
      referenceTweets: voice.referenceTweets,
      fingerprintBlock: voice.fingerprintBlock,
    });

    await writeTrace({
      generationId: generation.id,
      agent: "editor",
      eventType: editorResult.changed
        ? "complete_with_changes"
        : "complete_no_changes",
      payload: { issues: editorResult.issuesFound, changed: editorResult.changed },
      model: editorResult.model,
      tokensIn: editorResult.tokensIn,
      tokensOut: editorResult.tokensOut,
      costUsd: editorResult.costUsd.toString(),
    });

    const totalTokensIn = writerResult.tokensIn + editorResult.tokensIn;
    const totalTokensOut = writerResult.tokensOut + editorResult.tokensOut;
    const totalCost = writerResult.costUsd + editorResult.costUsd;
    const finalText = editorResult.texts[0] ?? writerResult.text;

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

    const inserted: Post[] = await db
      .insert(posts)
      .values({
        generationId: generation.id,
        contentType: "single",
        text: finalText,
        status: "draft",
        quoteTweetId: viral.xTweetId,
      })
      .returning();

    return Response.json(
      {
        generation: {
          id: generation.id,
          model: `${writerResult.model} + ${editorResult.model}`,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          costUsd: totalCost,
        },
        editor: {
          changed: editorResult.changed,
          issuesFound: editorResult.issuesFound,
        },
        posts: inserted,
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
      agent: "qrt",
      eventType: "error",
      payload: { message },
    });

    return Response.json(
      { error: "qrt generation failed", message, generationId: generation.id },
      { status: 500 },
    );
  }
}
