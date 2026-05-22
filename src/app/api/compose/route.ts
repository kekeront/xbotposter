import { eq } from "drizzle-orm";
import { z } from "zod";
import { review } from "@/agents/editor";
import { evaluate, type EvalOutput } from "@/agents/evaluator";
import { draft } from "@/agents/writer";
import { db } from "@/db/client";
import {
  type ContentType,
  generations,
  posts,
  type Post,
} from "@/db/schema";
import { writeTrace } from "@/lib/trace";
import { loadDefaultVoice, type LoadedVoice } from "@/lib/voice-load";

const ComposeRequest = z.object({
  topic: z.string().min(1).max(2000),
  contentType: z.enum(["single", "thread"]).default("single"),
  mode: z.enum(["ai", "manual"]).default("ai"),
  variants: z.number().int().min(1).max(3).default(1),
});

type VariantResult = {
  index: number;
  texts: string[];
  writerCost: number;
  editorCost: number;
  evalCost: number;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  editorIssues: string[];
  editorChanged: boolean;
  evalScores: EvalOutput["scores"];
  evalOverall: number;
  evalCritique: string;
  writerModel: string;
  editorModel: string;
  evalModel: string;
};

async function runVariant(
  index: number,
  topic: string,
  contentType: "single" | "thread",
  voice: LoadedVoice,
  generationId: string,
): Promise<VariantResult> {
  await writeTrace({
    generationId,
    agent: "writer",
    eventType: "start",
    payload: { variantIndex: index },
  });
  const writerResult = await draft({
    topic,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
  });
  await writeTrace({
    generationId,
    agent: "writer",
    eventType: "complete",
    payload: { variantIndex: index, posts: writerResult.texts.length },
    model: writerResult.model,
    tokensIn: writerResult.tokensIn,
    tokensOut: writerResult.tokensOut,
    costUsd: writerResult.costUsd.toString(),
  });

  const editorResult = await review({
    topic,
    drafts: writerResult.texts,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
  });
  await writeTrace({
    generationId,
    agent: "editor",
    eventType: editorResult.changed
      ? "complete_with_changes"
      : "complete_no_changes",
    payload: {
      variantIndex: index,
      issues: editorResult.issuesFound,
      changed: editorResult.changed,
    },
    model: editorResult.model,
    tokensIn: editorResult.tokensIn,
    tokensOut: editorResult.tokensOut,
    costUsd: editorResult.costUsd.toString(),
  });

  const evalResult = await evaluate({
    seed: topic,
    draft: editorResult.texts,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
  });
  await writeTrace({
    generationId,
    agent: "evaluator",
    eventType: "complete",
    payload: {
      variantIndex: index,
      overall: evalResult.overall,
      scores: evalResult.scores,
      critique: evalResult.critique,
    },
    model: evalResult.model,
    tokensIn: evalResult.tokensIn,
    tokensOut: evalResult.tokensOut,
    costUsd: evalResult.costUsd.toString(),
  });

  return {
    index,
    texts: editorResult.texts,
    writerCost: writerResult.costUsd,
    editorCost: editorResult.costUsd,
    evalCost: evalResult.costUsd,
    totalCost: writerResult.costUsd + editorResult.costUsd + evalResult.costUsd,
    tokensIn:
      writerResult.tokensIn + editorResult.tokensIn + evalResult.tokensIn,
    tokensOut:
      writerResult.tokensOut + editorResult.tokensOut + evalResult.tokensOut,
    editorIssues: editorResult.issuesFound,
    editorChanged: editorResult.changed,
    evalScores: evalResult.scores,
    evalOverall: evalResult.overall,
    evalCritique: evalResult.critique,
    writerModel: writerResult.model,
    editorModel: editorResult.model,
    evalModel: evalResult.model,
  };
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
  const { topic, contentType, mode, variants } = parsed.data;

  const [generation] = await db
    .insert(generations)
    .values({
      topic,
      inputMeta: { contentType, mode, variants },
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
    payload: { contentType, mode, variants, length: topic.length },
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

    // mode === "ai" — writer → editor → evaluator pipeline, optionally N variants
    const voice = await loadDefaultVoice();

    const variantResults = await Promise.all(
      Array.from({ length: variants }, (_, i) =>
        runVariant(i, topic, contentType, voice, generation.id),
      ),
    );

    // Sort by overall eval score desc; winner becomes the actual queue draft.
    variantResults.sort((a, b) => b.evalOverall - a.evalOverall);
    const winner = variantResults[0]!;

    const totalCost = variantResults.reduce((s, v) => s + v.totalCost, 0);
    const totalTokensIn = variantResults.reduce((s, v) => s + v.tokensIn, 0);
    const totalTokensOut = variantResults.reduce((s, v) => s + v.tokensOut, 0);

    await db
      .update(generations)
      .set({
        status: "succeeded",
        model: `${winner.writerModel} + ${winner.editorModel} + ${winner.evalModel}`,
        inputMeta: {
          contentType,
          mode,
          variants,
          winnerEval: {
            scores: winner.evalScores,
            overall: winner.evalOverall,
            critique: winner.evalCritique,
          },
          allVariants: variantResults.map((v) => ({
            index: v.index,
            overall: v.evalOverall,
            scores: v.evalScores,
            critique: v.evalCritique,
            firstChars: v.texts[0]?.slice(0, 60) ?? "",
          })),
        },
        tokensIn: totalTokensIn,
        tokensOut: totalTokensOut,
        costUsd: totalCost.toString(),
        completedAt: new Date(),
      })
      .where(eq(generations.id, generation.id));

    const createdPosts = await insertPostChain(
      generation.id,
      contentType,
      winner.texts,
    );

    await writeTrace({
      generationId: generation.id,
      agent: "compose",
      eventType: "complete",
      payload: {
        variants,
        winnerIndex: winner.index,
        winnerOverall: winner.evalOverall,
        rankedScores: variantResults.map((v) => v.evalOverall),
      },
    });

    return Response.json(
      {
        generation: {
          id: generation.id,
          status: "succeeded" as const,
          model: `${winner.writerModel} + ${winner.editorModel} + ${winner.evalModel}`,
          tokensIn: totalTokensIn,
          tokensOut: totalTokensOut,
          costUsd: totalCost,
        },
        editor: {
          changed: winner.editorChanged,
          issuesFound: winner.editorIssues,
        },
        eval: {
          scores: winner.evalScores,
          overall: winner.evalOverall,
          critique: winner.evalCritique,
        },
        variants: variantResults.map((v) => ({
          index: v.index,
          texts: v.texts,
          overall: v.evalOverall,
          scores: v.evalScores,
          critique: v.evalCritique,
          isWinner: v.index === winner.index,
        })),
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
