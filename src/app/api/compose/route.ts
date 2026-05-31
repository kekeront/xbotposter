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
import { search as searchWeb } from "@/agents/searcher";
import { requireUser } from "@/lib/auth";
import { recallMemoryBlock } from "@/lib/memory-bridge";
import {
  persistSearchSources,
  buildSourceUrlToIdMap,
  fetchRecentUploadedSources,
  buildSourceContextBlock,
} from "@/lib/source-persist";
import { checkSpendCap } from "@/lib/spend-cap";
import { writeTrace } from "@/lib/trace";
import { loadDefaultVoice, type LoadedVoice } from "@/lib/voice-load";

export const maxDuration = 120;

const PreferencesSchema = z.object({
  tone: z.string().max(100).optional(),
  audience: z.string().max(100).optional(),
  language: z.string().max(50).optional(),
  negatives: z.array(z.string().max(200)).max(20).optional(),
  customInstruction: z.string().max(500).optional(),
}).optional();

const ComposeRequest = z.object({
  topic: z.string().min(1).max(2000),
  contentType: z.enum(["single", "thread", "essay"]).default("single"),
  mode: z.enum(["ai", "manual"]).default("ai"),
  variants: z.number().int().min(1).max(3).default(1),
  preferences: PreferencesSchema,
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

type ProgressEmitter = (step: string, detail?: string) => void;

async function runVariant(
  index: number,
  topic: string,
  contentType: "single" | "thread" | "essay",
  voice: LoadedVoice,
  generationId: string,
  emit: ProgressEmitter,
  sharedOutlineBeats?: string[],
  memoryBlock?: string,
  researchBlock?: string,
  preferences?: z.infer<typeof PreferencesSchema>,
): Promise<VariantResult> {
  const tag = `variant ${index + 1}`;

  emit("writer", tag);
  await writeTrace({
    generationId,
    agent: "writer",
    eventType: "start",
    payload: {
      variantIndex: index,
      outlineBeats: sharedOutlineBeats?.length ?? 0,
      memoryBytes: memoryBlock?.length ?? 0,
    },
  });
  const traceCtx = { generationId, agent: "writer" };
  const writerResult = await draft({
    topic,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
    outlineBeats: sharedOutlineBeats,
    memoryBlock,
    researchBlock,
    preferences,
    traceContext: traceCtx,
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

  emit("editor", tag);
  const editorResult = await review({
    topic,
    drafts: writerResult.texts,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
    traceContext: { generationId, agent: "editor" },
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

  emit("eval", tag);
  const [evalResult, factResult] = await Promise.all([
    evaluate({
      seed: topic,
      draft: editorResult.texts,
      contentType,
      referenceTweets: voice.referenceTweets,
      fingerprintBlock: voice.fingerprintBlock,
      traceContext: { generationId, agent: "evaluator" },
    }),
    check({
      seed: topic,
      draft: editorResult.texts,
      researchBlock,
      traceContext: { generationId, agent: "fact-checker" },
    }),
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

// Multi-variant phase 1: draft + score the RAW draft only. Editor and
// fact-checker are deferred to the winner (see finalizeWinner) so we don't pay
// to edit and fact-check variants that get discarded. Used only when
// variants > 1; the single-variant path keeps the full runVariant pipeline.
async function draftAndScore(
  index: number,
  topic: string,
  contentType: "single" | "thread" | "essay",
  voice: LoadedVoice,
  generationId: string,
  emit: ProgressEmitter,
  sharedOutlineBeats?: string[],
  memoryBlock?: string,
  researchBlock?: string,
  preferences?: z.infer<typeof PreferencesSchema>,
): Promise<VariantResult> {
  const tag = `variant ${index + 1}`;

  emit("writer", tag);
  await writeTrace({
    generationId,
    agent: "writer",
    eventType: "start",
    payload: {
      variantIndex: index,
      outlineBeats: sharedOutlineBeats?.length ?? 0,
      memoryBytes: memoryBlock?.length ?? 0,
    },
  });
  const writerResult = await draft({
    topic,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
    outlineBeats: sharedOutlineBeats,
    memoryBlock,
    researchBlock,
    preferences,
    traceContext: { generationId, agent: "writer" },
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

  emit("eval", tag);
  const evalResult = await evaluate({
    seed: topic,
    draft: writerResult.texts,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
    traceContext: { generationId, agent: "evaluator" },
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
    texts: writerResult.texts,
    writerCost: writerResult.costUsd,
    editorCost: 0,
    evalCost: evalResult.costUsd,
    factCost: 0,
    totalCost: writerResult.costUsd + evalResult.costUsd,
    tokensIn: writerResult.tokensIn + evalResult.tokensIn,
    tokensOut: writerResult.tokensOut + evalResult.tokensOut,
    editorIssues: [],
    editorChanged: false,
    evalScores: evalResult.scores,
    evalOverall: evalResult.overall,
    evalCritique: evalResult.critique,
    factClaims: [],
    factInventedCount: 0,
    writerModel: writerResult.model,
    editorModel: "",
    evalModel: evalResult.model,
    factModel: "",
  };
}

// Multi-variant phase 2: edit + fact-check the chosen winner only, folding its
// added cost/tokens back into the VariantResult. Mutates and returns `winner`.
async function finalizeWinner(
  winner: VariantResult,
  topic: string,
  contentType: "single" | "thread" | "essay",
  voice: LoadedVoice,
  generationId: string,
  emit: ProgressEmitter,
  researchBlock?: string,
): Promise<VariantResult> {
  const tag = `winner (variant ${winner.index + 1})`;

  emit("editor", tag);
  const editorResult = await review({
    topic,
    drafts: winner.texts,
    contentType,
    referenceTweets: voice.referenceTweets,
    fingerprintBlock: voice.fingerprintBlock,
    traceContext: { generationId, agent: "editor" },
  });
  await writeTrace({
    generationId,
    agent: "editor",
    eventType: editorResult.changed
      ? "complete_with_changes"
      : "complete_no_changes",
    payload: {
      variantIndex: winner.index,
      issues: editorResult.issuesFound,
      changed: editorResult.changed,
    },
    model: editorResult.model,
    tokensIn: editorResult.tokensIn,
    tokensOut: editorResult.tokensOut,
    costUsd: editorResult.costUsd.toString(),
  });

  emit("eval", tag);
  const factResult = await check({
    seed: topic,
    draft: editorResult.texts,
    researchBlock,
    traceContext: { generationId, agent: "fact-checker" },
  });
  await writeTrace({
    generationId,
    agent: "fact-checker",
    eventType: factResult.hasInvented ? "complete_with_invented" : "complete",
    payload: {
      variantIndex: winner.index,
      claimsCount: factResult.claims.length,
      invented: factResult.inventedCount,
      uncertain: factResult.uncertainCount,
    },
    model: factResult.model,
    tokensIn: factResult.tokensIn,
    tokensOut: factResult.tokensOut,
    costUsd: factResult.costUsd.toString(),
  });

  winner.texts = editorResult.texts;
  winner.editorCost = editorResult.costUsd;
  winner.factCost = factResult.costUsd;
  winner.editorIssues = editorResult.issuesFound;
  winner.editorChanged = editorResult.changed;
  winner.factClaims = factResult.claims;
  winner.factInventedCount = factResult.inventedCount;
  winner.editorModel = editorResult.model;
  winner.factModel = factResult.model;
  winner.totalCost += editorResult.costUsd + factResult.costUsd;
  winner.tokensIn += editorResult.tokensIn + factResult.tokensIn;
  winner.tokensOut += editorResult.tokensOut + factResult.tokensOut;

  return winner;
}

async function insertPostChain(
  generationId: string,
  contentType: ContentType,
  texts: string[],
  userId: string,
): Promise<Post[]> {
  const out: Post[] = [];
  let parentId: string | null = null;
  for (let i = 0; i < texts.length; i++) {
    const text = texts[i];
    if (!text) continue;
    const inserted: Post[] = await db
      .insert(posts)
      .values({
        userId,
        generationId,
        parentPostId: parentId,
        threadPosition: contentType === "thread" ? i + 1 : null,
        contentType,
        text,
        status: "approved",
      })
      .returning();
    const row = inserted[0];
    if (!row) continue;
    out.push(row);
    if (i === 0 && contentType === "thread") parentId = row.id;
  }
  return out;
}

const encoder = new TextEncoder();

function sseEncode(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

export async function POST(request: Request) {
  const user = await requireUser();

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
  const { topic, contentType, mode, variants, preferences } = parsed.data;

  if (mode === "ai") {
    const verdict = await checkSpendCap();
    if (!verdict.allow) {
      return Response.json(
        {
          error: "spend_cap",
          message: verdict.reason,
          todayUsd: verdict.todayUsd,
          capUsd: verdict.capUsd,
        },
        { status: 429 },
      );
    }
  }

  const [generation] = await db
    .insert(generations)
    .values({
      userId: user.id,
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

  // Manual mode: no streaming needed, return immediately.
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
      user.id,
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

  // AI mode: load voice + memory in parallel before the stream.
  const [voice, memoryContext] = await Promise.all([
    loadDefaultVoice(),
    recallMemoryBlock(topic),
  ]);

  const stream = new ReadableStream({
    async start(controller) {
      // Flush a 2KB padding comment to push past any HTTP/gzip buffering.
      controller.enqueue(sseEncode("progress", { step: "search", detail: "researching topic" }));
      controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`));

      const emit: ProgressEmitter = (step, detail) => {
        try {
          controller.enqueue(sseEncode("progress", { step, detail }));
        } catch {
          // stream closed by client
        }
      };

      let dbSucceeded = false;

      try {
        if (memoryContext.block) {
          await writeTrace({
            generationId: generation.id,
            agent: "memory",
            eventType: "recall",
            payload: {
              citations: memoryContext.citationCount,
              bytes: memoryContext.block.length,
              embedError: memoryContext.embedError,
            },
          });
        }

        let researchBlock = "";
        let sourceUrlToId = new Map<string, string>();
        let searchCost = 0;

        const [searchResult, uploaded] = await Promise.all([
          searchWeb({ topic }).catch((err) => {
            writeTrace({
              generationId: generation.id,
              agent: "searcher",
              eventType: "error",
              payload: { message: err instanceof Error ? err.message : String(err) },
            });
            return null;
          }),
          fetchRecentUploadedSources({ limit: 5 }).catch(() => []),
        ]);

        if (searchResult) {
          researchBlock = searchResult.researchBlock;
          searchCost = searchResult.costUsd;
          if (researchBlock) {
            const persisted = await persistSearchSources(searchResult.sources);
            sourceUrlToId = buildSourceUrlToIdMap(persisted);
            await writeTrace({
              generationId: generation.id,
              agent: "searcher",
              eventType: "complete",
              payload: {
                sources: searchResult.sources.length,
                persisted: persisted.length,
                bytes: researchBlock.length,
              },
              model: searchResult.model,
              tokensIn: searchResult.tokensIn,
              tokensOut: searchResult.tokensOut,
              costUsd: searchResult.costUsd.toString(),
            });
          }
        }

        const uploadedBlock = buildSourceContextBlock(uploaded);
        if (uploadedBlock) {
          researchBlock = researchBlock
            ? `${researchBlock}\n\n${uploadedBlock}`
            : uploadedBlock;
          for (const s of uploaded) {
            if (s.url) sourceUrlToId.set(s.url, s.id);
          }
        }

        emit("writer", "starting pipeline");

        let outlineBeats: string[] | undefined;
        let outlineCost = 0;
        let outlineModel: string | null = null;
        if (contentType === "thread") {
          emit("outline", "planning thread beats");
          const outlineResult = await outlineAgent({
            topic,
            referenceTweets: voice.referenceTweets,
            fingerprintBlock: voice.fingerprintBlock,
          });
          outlineBeats =
            outlineResult.beats.length > 0
              ? outlineResult.beats
              : undefined;
          outlineCost = outlineResult.costUsd;
          outlineModel = outlineResult.model;
          await writeTrace({
            generationId: generation.id,
            agent: "outliner",
            eventType:
              outlineResult.beats.length > 0 ? "complete" : "empty",
            payload: { beats: outlineResult.beats },
            model: outlineResult.model,
            tokensIn: outlineResult.tokensIn,
            tokensOut: outlineResult.tokensOut,
            costUsd: outlineResult.costUsd.toString(),
          });
        }

        let variantResults: VariantResult[];
        if (variants === 1) {
          // Nothing to discard — run the full pipeline on the single variant.
          variantResults = [
            await runVariant(
              0,
              topic,
              contentType,
              voice,
              generation.id,
              emit,
              outlineBeats,
              memoryContext.block,
              researchBlock,
              preferences,
            ),
          ];
        } else {
          // Draft + score every variant on its raw draft, then edit and
          // fact-check only the winner — the losing variants are discarded, so
          // editing/fact-checking them was pure waste.
          variantResults = await Promise.all(
            Array.from({ length: variants }, (_, i) =>
              draftAndScore(
                i,
                topic,
                contentType,
                voice,
                generation.id,
                emit,
                outlineBeats,
                memoryContext.block,
                researchBlock,
                preferences,
              ),
            ),
          );
          variantResults.sort((a, b) => b.evalOverall - a.evalOverall);
          await finalizeWinner(
            variantResults[0]!,
            topic,
            contentType,
            voice,
            generation.id,
            emit,
            researchBlock,
          );
        }

        variantResults.sort((a, b) => b.evalOverall - a.evalOverall);
        const winner = variantResults[0]!;

        const totalCost =
          searchCost +
          outlineCost +
          variantResults.reduce((s, v) => s + v.totalCost, 0);
        const totalTokensIn = variantResults.reduce(
          (s, v) => s + v.tokensIn,
          0,
        );
        const totalTokensOut = variantResults.reduce(
          (s, v) => s + v.tokensOut,
          0,
        );

        emit("saving", "persisting to queue");

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

        dbSucceeded = true;

        const createdPosts = await insertPostChain(
          generation.id,
          contentType,
          winner.texts,
          user.id,
        );

        if (winner.factClaims.length > 0 && createdPosts[0]) {
          const rootPostId = createdPosts[0].id;
          const claimRows = winner.factClaims.slice(0, 20).map((c) => ({
            postId: rootPostId,
            claimText: c.text,
            sourceId: c.sourceUrl ? sourceUrlToId.get(c.sourceUrl) ?? null : null,
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
              payload: {
                message:
                  err instanceof Error ? err.message : String(err),
              },
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

        controller.enqueue(
          sseEncode("result", {
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
          }),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "unknown error";

        if (!dbSucceeded) {
          await db
            .update(generations)
            .set({
              status: "failed",
              error: message,
              completedAt: new Date(),
            })
            .where(eq(generations.id, generation.id));
        }

        await writeTrace({
          generationId: generation.id,
          agent: "compose",
          eventType: "error",
          payload: { message },
        });

        try {
          controller.enqueue(sseEncode("error", { message }));
        } catch {
          // stream already closed by client disconnect
        }
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
