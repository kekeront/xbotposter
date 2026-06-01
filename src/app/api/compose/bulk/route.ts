import { eq } from "drizzle-orm";
import { z } from "zod";
import { generateAngles } from "@/agents/angles";
import { review } from "@/agents/editor";
import { evaluate } from "@/agents/evaluator";
import { check } from "@/agents/fact-checker";
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
import { loadDefaultVoice } from "@/lib/voice-load";

export const maxDuration = 300;

const PreferencesSchema = z.object({
  tone: z.string().max(100).optional(),
  audience: z.string().max(100).optional(),
  language: z.string().max(50).optional(),
  negatives: z.array(z.string().max(200)).max(20).optional(),
  customInstruction: z.string().max(500).optional(),
}).optional();

const BulkRequest = z.object({
  topic: z.string().min(1).max(2000),
  contentType: z.enum(["single", "thread"]).default("single"),
  angles: z.number().int().min(2).max(6).default(3),
  preferences: PreferencesSchema,
});

const encoder = new TextEncoder();

function sseEncode(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

export async function POST(request: Request) {
  const user = await requireUser();
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = BulkRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }

  const { topic, contentType, angles: angleCount, preferences } = parsed.data;

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

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(sseEncode("progress", { step: "research", detail: "researching topic" }));
      controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`));

      const emit = (step: string, detail?: string) => {
        try {
          controller.enqueue(sseEncode("progress", { step, detail }));
        } catch {
          // client disconnected
        }
      };

      let researchBlock = "";
      let sourceUrlToId = new Map<string, string>();
      let searchCost = 0;

      // Parallelize all pre-work: voice, memory, search, uploads, angles prep
      const [voice, memoryContext, searchResult, uploaded] = await Promise.all([
        loadDefaultVoice(),
        recallMemoryBlock(topic),
        searchWeb({ topic }).catch(() => null),
        fetchRecentUploadedSources({ limit: 5 }).catch(() => []),
      ]);

      if (searchResult) {
        researchBlock = searchResult.researchBlock;
        searchCost = searchResult.costUsd;
        if (researchBlock) {
          const persisted = await persistSearchSources(searchResult.sources);
          sourceUrlToId = buildSourceUrlToIdMap(persisted);
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

      emit("angles", "generating angles");

      let totalCostUsd = searchCost;

      try {
        const anglesResult = await generateAngles({
          topic,
          count: angleCount,
          referenceTweets: voice.referenceTweets,
          fingerprintBlock: voice.fingerprintBlock,
        });
        totalCostUsd += anglesResult.costUsd;

        controller.enqueue(
          sseEncode("angles_ready", {
            angles: anglesResult.angles,
            costUsd: anglesResult.costUsd,
          }),
        );

        type AngleResult = {
          angleIndex: number;
          hook: string;
          generationId: string;
          texts: string[];
          overall: number;
          scores: Record<string, number>;
          critique: string;
          costUsd: number;
          tokensIn: number;
          tokensOut: number;
          model: string;
          posts: Array<{
            id: string;
            text: string;
            threadPosition: number | null;
          }>;
        };

        type AngleOutcome =
          | { ok: true; result: AngleResult }
          | { ok: false; angleIndex: number; hook: string; costUsd: number };

        const processAngle = async (
          i: number,
          angle: { angle: string; hook: string },
          totalAngles: number,
        ): Promise<AngleOutcome> => {
          const label = `angle ${i + 1}/${totalAngles}`;

          const [generation] = await db
            .insert(generations)
            .values({
              userId: user.id,
              topic: angle.angle,
              inputMeta: {
                contentType,
                mode: "ai",
                variants: 1,
                bulkTopic: topic,
                angleIndex: i,
                angleHook: angle.hook,
              },
              status: "running",
            })
            .returning();

          if (!generation) {
            return { ok: false, angleIndex: i, hook: angle.hook, costUsd: 0 };
          }

          await writeTrace({
            generationId: generation.id,
            agent: "compose-bulk",
            eventType: "start",
            payload: { angleIndex: i, hook: angle.hook, contentType },
          });

          let dbSucceeded = false;
          // Accumulates real spend as each step completes, so a mid-pipeline
          // failure still reports the cost already incurred (not 0).
          let partialCost = 0;

          try {
            // Writer
            emit("writer", label);
            const writerResult = await draft({
              topic: angle.angle,
              contentType,
              referenceTweets: voice.referenceTweets,
              fingerprintBlock: voice.fingerprintBlock,
              memoryBlock: memoryContext.block,
              researchBlock,
              preferences,
            });
            partialCost += writerResult.costUsd;
            await writeTrace({
              generationId: generation.id,
              agent: "writer",
              eventType: "complete",
              payload: { posts: writerResult.texts.length },
              model: writerResult.model,
              tokensIn: writerResult.tokensIn,
              tokensOut: writerResult.tokensOut,
              costUsd: writerResult.costUsd.toString(),
            });

            // Editor
            emit("editor", label);
            const editorResult = await review({
              topic: angle.angle,
              drafts: writerResult.texts,
              contentType,
              language: preferences?.language,
              referenceTweets: voice.referenceTweets,
              fingerprintBlock: voice.fingerprintBlock,
            });
            await writeTrace({
              generationId: generation.id,
              agent: "editor",
              eventType: editorResult.changed
                ? "complete_with_changes"
                : "complete_no_changes",
              payload: {
                issues: editorResult.issuesFound,
                changed: editorResult.changed,
              },
              model: editorResult.model,
              tokensIn: editorResult.tokensIn,
              tokensOut: editorResult.tokensOut,
              costUsd: editorResult.costUsd.toString(),
            });
            partialCost += editorResult.costUsd;

            // Eval + fact-check in parallel
            emit("eval", label);
            const [evalResult, factResult] = await Promise.all([
              evaluate({
                seed: angle.angle,
                draft: editorResult.texts,
                contentType,
                language: preferences?.language,
                referenceTweets: voice.referenceTweets,
                fingerprintBlock: voice.fingerprintBlock,
              }),
              check({ seed: angle.angle, draft: editorResult.texts, researchBlock }),
            ]);
            partialCost += evalResult.costUsd + factResult.costUsd;

            await writeTrace({
              generationId: generation.id,
              agent: "evaluator",
              eventType: "complete",
              payload: {
                overall: evalResult.overall,
                scores: evalResult.scores,
                critique: evalResult.critique,
              },
              model: evalResult.model,
              tokensIn: evalResult.tokensIn,
              tokensOut: evalResult.tokensOut,
              costUsd: evalResult.costUsd.toString(),
            });

            const angleCost =
              writerResult.costUsd +
              editorResult.costUsd +
              evalResult.costUsd +
              factResult.costUsd;
            const angleTokensIn =
              writerResult.tokensIn +
              editorResult.tokensIn +
              evalResult.tokensIn +
              factResult.tokensIn;
            const angleTokensOut =
              writerResult.tokensOut +
              editorResult.tokensOut +
              evalResult.tokensOut +
              factResult.tokensOut;

            // Save
            emit("saving", label);
            await db
              .update(generations)
              .set({
                status: "succeeded",
                model: `${writerResult.model} + ${editorResult.model} + ${evalResult.model} + ${factResult.model}`,
                tokensIn: angleTokensIn,
                tokensOut: angleTokensOut,
                costUsd: angleCost.toString(),
                completedAt: new Date(),
              })
              .where(eq(generations.id, generation.id));

            dbSucceeded = true;

            const createdPosts = await insertPostChain(
              generation.id,
              contentType,
              editorResult.texts,
              user.id,
            );

            if (factResult.claims.length > 0 && createdPosts[0]) {
              const claimRows = factResult.claims.slice(0, 20).map((c) => ({
                postId: createdPosts[0]!.id,
                claimText: c.text,
                sourceId: c.sourceUrl ? sourceUrlToId.get(c.sourceUrl) ?? null : null,
                verified: c.verdict === "supported",
                notes: `${c.verdict}: ${c.reason}`,
              }));
              try {
                await db.insert(claims).values(claimRows);
              } catch {
                // claims insert is non-critical
              }
            }

            const angleResult: AngleResult = {
              angleIndex: i,
              hook: angle.hook,
              generationId: generation.id,
              texts: editorResult.texts,
              overall: evalResult.overall,
              scores: evalResult.scores,
              critique: evalResult.critique,
              costUsd: angleCost,
              tokensIn: angleTokensIn,
              tokensOut: angleTokensOut,
              model: writerResult.model,
              posts: createdPosts.map((p) => ({
                id: p.id,
                text: p.text,
                threadPosition: p.threadPosition,
              })),
            };

            try {
              controller.enqueue(sseEncode("angle_done", angleResult));
            } catch {
              // client disconnected
            }

            await writeTrace({
              generationId: generation.id,
              agent: "compose-bulk",
              eventType: "complete",
              payload: {
                angleIndex: i,
                overall: evalResult.overall,
                postCount: createdPosts.length,
              },
            });

            return { ok: true, result: angleResult };
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
              agent: "compose-bulk",
              eventType: "error",
              payload: { angleIndex: i, message },
            });

            try {
              controller.enqueue(
                sseEncode("angle_error", {
                  angleIndex: i,
                  hook: angle.hook,
                  message,
                }),
              );
            } catch {
              // client disconnected
            }

            return {
              ok: false,
              angleIndex: i,
              hook: angle.hook,
              costUsd: partialCost,
            };
          }
        };

        // Spend cap is gated once here, before launching the batch. Angles then
        // run concurrently (like the variants path in compose/route.ts), so a
        // per-angle check is omitted: with full parallelism every angle would
        // read the cap before any of them has incurred cost, making it useless,
        // and it would spam spend_cap events. Worst-case overshoot is therefore
        // bounded to one parallel batch of angles (max 6, each a small generation).
        const batchVerdict = await checkSpendCap();
        if (!batchVerdict.allow) {
          controller.enqueue(
            sseEncode("spend_cap", {
              message: batchVerdict.reason,
              completedAngles: 0,
              totalAngles: anglesResult.angles.length,
            }),
          );
          controller.enqueue(
            sseEncode("result", {
              totalAngles: anglesResult.angles.length,
              completedAngles: 0,
              totalCostUsd,
              results: [],
            }),
          );
          return;
        }

        // Run all angles concurrently; each emits its own SSE events as it finishes.
        const outcomes = await Promise.all(
          anglesResult.angles.map((angle, i) =>
            processAngle(i, angle, anglesResult.angles.length),
          ),
        );

        const results: AngleResult[] = outcomes
          .filter((o): o is { ok: true; result: AngleResult } => o.ok)
          .map((o) => o.result)
          .sort((a, b) => a.angleIndex - b.angleIndex);

        totalCostUsd += outcomes.reduce(
          (sum, o) => sum + (o.ok ? o.result.costUsd : o.costUsd),
          0,
        );

        controller.enqueue(
          sseEncode("result", {
            totalAngles: anglesResult.angles.length,
            completedAngles: results.length,
            totalCostUsd,
            results,
          }),
        );
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "unknown error";
        try {
          controller.enqueue(sseEncode("error", { message }));
        } catch {
          // stream closed
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
