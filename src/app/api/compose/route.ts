import { eq } from "drizzle-orm";
import { z } from "zod";
import { review } from "@/agents/editor";
import { evaluate, type EvalOutput } from "@/agents/evaluator";
import { check, type FactCheckOutput } from "@/agents/fact-checker";
import { outline as outlineAgent } from "@/agents/outliner";
import { draft } from "@/agents/writer";
import { db } from "@/db/client";
import {
  claims,
  type ContentType,
  generations,
  posts,
  type Post,
} from "@/db/schema";
import { recallMemories } from "@/lib/recall";
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
  factCost: number;
  totalCost: number;
  tokensIn: number;
  tokensOut: number;
  editorIssues: string[];
  editorChanged: boolean;
  evalScores: EvalOutput["scores"];
  evalOverall: number;
  evalCritique: string;
  factClaims: FactCheckOutput["claims"];
  factInventedCount: number;
  writerModel: string;
  editorModel: string;
  evalModel: string;
  factModel: string;
};

async function runVariant(
  index: number,
  topic: string,
  contentType: "single" | "thread",
  voice: LoadedVoice,
  memoryBlock: string,
  generationId: string,
  sharedOutlineBeats?: string[],
): Promise<VariantResult> {
  await writeTrace({
    generationId,
    agent: "writer",
    eventType: "start",
    payload: {
      variantIndex: index,
      outlineBeats: sharedOutlineBeats?.length ?? 0,
      memoryItems: memoryBlock ? memoryBlock.split("\n- ").length - 1 : 0,
    },
  });
  const writerResult = await draft({
    topic,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
    outlineBeats: sharedOutlineBeats,
    memoryBlock,
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

  // Fact-checker and evaluator both inspect the editor output — run in parallel.
  const [evalResult, factResult] = await Promise.all([
    evaluate({
      seed: topic,
      draft: editorResult.texts,
      contentType,
      referenceTweets: voice.referenceTweets,
      fingerprintBlock: voice.fingerprintBlock,
    }),
    check({ seed: topic, draft: editorResult.texts }),
  ]);

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

  await writeTrace({
    generationId,
    agent: "fact-checker",
    eventType: factResult.hasInvented
      ? "complete_with_invented"
      : "complete",
    payload: {
      variantIndex: index,
      claimsCount: factResult.claims.length,
      invented: factResult.inventedCount,
      uncertain: factResult.uncertainCount,
    },
    model: factResult.model,
    tokensIn: factResult.tokensIn,
    tokensOut: factResult.tokensOut,
    costUsd: factResult.costUsd.toString(),
  });

  return {
    index,
    texts: editorResult.texts,
    writerCost: writerResult.costUsd,
    editorCost: editorResult.costUsd,
    evalCost: evalResult.costUsd,
    factCost: factResult.costUsd,
    totalCost:
      writerResult.costUsd +
      editorResult.costUsd +
      evalResult.costUsd +
      factResult.costUsd,
    tokensIn:
      writerResult.tokensIn +
      editorResult.tokensIn +
      evalResult.tokensIn +
      factResult.tokensIn,
    tokensOut:
      writerResult.tokensOut +
      editorResult.tokensOut +
      evalResult.tokensOut +
      factResult.tokensOut,
    editorIssues: editorResult.issuesFound,
    editorChanged: editorResult.changed,
    evalScores: evalResult.scores,
    evalOverall: evalResult.overall,
    evalCritique: evalResult.critique,
    factClaims: factResult.claims,
    factInventedCount: factResult.inventedCount,
    writerModel: writerResult.model,
    editorModel: editorResult.model,
    evalModel: evalResult.model,
    factModel: factResult.model,
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

    // mode === "ai" — outline (threads only) → writer → editor → [eval | fact-check] in parallel
    const voice = await loadDefaultVoice();
    const recall = await recallMemories({ query: topic });
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

    let outlineBeats: string[] | undefined;
    let outlineCost = 0;
    let outlineModel: string | null = null;
    if (contentType === "thread") {
      const outlineResult = await outlineAgent({
        topic,
        referenceTweets: voice.referenceTweets,
        fingerprintBlock: voice.fingerprintBlock,
      });
      outlineBeats = outlineResult.beats.length > 0 ? outlineResult.beats : undefined;
      outlineCost = outlineResult.costUsd;
      outlineModel = outlineResult.model;
      await writeTrace({
        generationId: generation.id,
        agent: "outliner",
        eventType: outlineResult.beats.length > 0 ? "complete" : "empty",
        payload: { beats: outlineResult.beats },
        model: outlineResult.model,
        tokensIn: outlineResult.tokensIn,
        tokensOut: outlineResult.tokensOut,
        costUsd: outlineResult.costUsd.toString(),
      });
    }

    const variantResults = await Promise.all(
      Array.from({ length: variants }, (_, i) =>
        runVariant(
          i,
          topic,
          contentType,
          voice,
          recall.promptBlock,
          generation.id,
          outlineBeats,
        ),
      ),
    );

    // Sort by overall eval score desc; winner becomes the actual queue draft.
    variantResults.sort((a, b) => b.evalOverall - a.evalOverall);
    const winner = variantResults[0]!;

    const totalCost =
      outlineCost + variantResults.reduce((s, v) => s + v.totalCost, 0);
    const totalTokensIn = variantResults.reduce((s, v) => s + v.tokensIn, 0);
    const totalTokensOut = variantResults.reduce((s, v) => s + v.tokensOut, 0);

    await db
      .update(generations)
      .set({
        status: "succeeded",
        model: `${outlineModel ? `${outlineModel} + ` : ""}${winner.writerModel} + ${winner.editorModel} + ${winner.evalModel} + ${winner.factModel}`,
        inputMeta: {
          contentType,
          mode,
          variants,
          outlineBeats: outlineBeats ?? null,
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
            texts: v.texts,
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

    // Persist the winner's fact-check claims linked to the first post.
    if (winner.factClaims.length > 0 && createdPosts[0]) {
      const rootPostId = createdPosts[0].id;
      const claimRows = winner.factClaims.slice(0, 20).map((c) => ({
        postId: rootPostId,
        claimText: c.text,
        verified: c.verdict === "supported",
        notes: `${c.verdict}: ${c.reason}`,
      }));
      try {
        await db.insert(claims).values(claimRows);
      } catch (err) {
        await writeTrace({
          generationId: generation.id,
          agent: "compose",
          eventType: "claims_insert_failed",
          payload: { message: err instanceof Error ? err.message : String(err) },
        });
      }
    }

    await writeTrace({
      generationId: generation.id,
      agent: "compose",
      eventType: "complete",
      payload: {
        variants,
        winnerIndex: winner.index,
        winnerOverall: winner.evalOverall,
        rankedScores: variantResults.map((v) => v.evalOverall),
        winnerInventedClaims: winner.factInventedCount,
      },
    });

    return Response.json(
      {
        generation: {
          id: generation.id,
          status: "succeeded" as const,
          model: `${winner.writerModel} + ${winner.editorModel} + ${winner.evalModel} + ${winner.factModel}`,
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
        factCheck: {
          claims: winner.factClaims,
          inventedCount: winner.factInventedCount,
        },
        variants: variantResults.map((v) => ({
          index: v.index,
          texts: v.texts,
          overall: v.evalOverall,
          scores: v.evalScores,
          critique: v.evalCritique,
          factClaims: v.factClaims,
          factInventedCount: v.factInventedCount,
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
