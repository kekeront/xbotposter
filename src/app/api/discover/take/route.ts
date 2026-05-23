import { eq } from "drizzle-orm";
import { z } from "zod";
import { review } from "@/agents/editor";
import { draft as takeDraft } from "@/agents/take";
import { check as guardCheck } from "@/agents/topic-guard";
import { db } from "@/db/client";
import {
  type ContentType,
  generations,
  posts,
  viralPosts,
  type Post,
} from "@/db/schema";
import { recallMemories } from "@/lib/recall";
import { writeTrace } from "@/lib/trace";
import { loadDefaultVoice } from "@/lib/voice-load";

const TakeRequest = z.object({
  viralPostId: z.string().uuid(),
  userAngle: z.string().max(500).optional(),
  contentType: z.enum(["single", "thread"]).default("single"),
});

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

  const parsed = TakeRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { viralPostId, userAngle, contentType } = parsed.data;

  const viralRows = await db
    .select()
    .from(viralPosts)
    .where(eq(viralPosts.id, viralPostId))
    .limit(1);
  const viral = viralRows[0];
  if (!viral) {
    return Response.json({ error: "viral post not found" }, { status: 404 });
  }

  const author = viral.author ?? "unknown";

  // Topic safety gate — block politically/sensitively charged sources before
  // spending any tokens on the writer.
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
      mode: "take",
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
      topic: `take on @${author}: ${viral.text.slice(0, 100)}`,
      inputMeta: {
        contentType,
        mode: "take",
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
    agent: "take",
    eventType: "start",
    payload: { viralAuthor: author, contentType, hasAngle: !!userAngle },
  });

  try {
    const voice = await loadDefaultVoice();
    const recall = await recallMemories({
      query: userAngle ? `${userAngle}\n\n${viral.text}` : viral.text,
    });
    if (recall.memories.length > 0) {
      await writeTrace({
        generationId: generation.id,
        agent: "recall",
        eventType: "complete",
        payload: {
          itemsIncluded: recall.memories.length,
          diagnostics: recall.diagnostics,
        },
        costUsd: recall.cost.embed.toString(),
      });
    }

    const writerResult = await takeDraft({
      viralText: viral.text,
      viralAuthor: author,
      userAngle: userAngle ?? null,
      contentType,
      referenceTweets: voice.referenceTweets,
      fingerprintBlock: voice.fingerprintBlock,
      memoryBlock: recall.promptBlock,
    });

    await writeTrace({
      generationId: generation.id,
      agent: "take",
      eventType: "complete",
      payload: { variants: writerResult.texts.length },
      model: writerResult.model,
      tokensIn: writerResult.tokensIn,
      tokensOut: writerResult.tokensOut,
      costUsd: writerResult.costUsd.toString(),
    });

    const editorResult = await review({
      topic: userAngle
        ? `${userAngle} (reacting to @${author}: ${viral.text})`
        : `Reacting to @${author}: ${viral.text}`,
      drafts: writerResult.texts,
      contentType,
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

    const createdPosts = await insertPostChain(
      generation.id,
      contentType,
      editorResult.texts,
    );

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
      agent: "take",
      eventType: "error",
      payload: { message },
    });

    return Response.json(
      { error: "take generation failed", message, generationId: generation.id },
      { status: 500 },
    );
  }
}
