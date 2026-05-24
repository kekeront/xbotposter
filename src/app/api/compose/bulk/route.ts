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
import { recallMemoryBlock } from "@/lib/memory-bridge";
import { checkSpendCap } from "@/lib/spend-cap";
import { writeTrace } from "@/lib/trace";
import { loadDefaultVoice } from "@/lib/voice-load";

export const maxDuration = 300;

const BulkRequest = z.object({
  topic: z.string().min(1).max(2000),
  contentType: z.enum(["single", "thread"]).default("single"),
  angles: z.number().int().min(2).max(6).default(3),
});

const encoder = new TextEncoder();

function sseEncode(event: string, data: unknown): Uint8Array {
  return encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
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

  const { topic, contentType, angles: angleCount } = parsed.data;

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

  // Load voice + memory before the stream so the first SSE event flushes.
  const voice = await loadDefaultVoice();
  const memoryContext = await recallMemoryBlock(topic);

  const stream = new ReadableStream({
    async start(controller) {
      // Flush a 2KB padding comment to push past HTTP/gzip buffering.
      controller.enqueue(sseEncode("progress", { step: "angles", detail: "generating angles" }));
      controller.enqueue(encoder.encode(`: ${" ".repeat(2048)}\n\n`));

      const emit = (step: string, detail?: string) => {
        try {
          controller.enqueue(sseEncode("progress", { step, detail }));
        } catch {
          // client disconnected
        }
      };

      let totalCostUsd = 0;

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

        const results: Array<{
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
        }> = [];

        // Run each angle sequentially to control spend.
        for (let i = 0; i < anglesResult.angles.length; i++) {
          const angle = anglesResult.angles[i]!;
          const label = `angle ${i + 1}/${anglesResult.angles.length}`;

          // Re-check spend cap before each angle.
          const midVerdict = await checkSpendCap();
          if (!midVerdict.allow) {
            controller.enqueue(
              sseEncode("spend_cap", {
                message: midVerdict.reason,
                completedAngles: results.length,
                totalAngles: anglesResult.angles.length,
              }),
            );
            break;
          }

          const [generation] = await db
            .insert(generations)
            .values({
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

          if (!generation) continue;

          await writeTrace({
            generationId: generation.id,
            agent: "compose-bulk",
            eventType: "start",
            payload: { angleIndex: i, hook: angle.hook, contentType },
          });

          let dbSucceeded = false;

          try {
            // Writer
            emit("writer", label);
            const writerResult = await draft({
              topic: angle.angle,
              contentType,
              referenceTweets: voice.referenceTweets,
              fingerprintBlock: voice.fingerprintBlock,
              memoryBlock: memoryContext.block,
            });
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

            // Eval + fact-check in parallel
            emit("eval", label);
            const [evalResult, factResult] = await Promise.all([
              evaluate({
                seed: angle.angle,
                draft: editorResult.texts,
                contentType,
                referenceTweets: voice.referenceTweets,
                fingerprintBlock: voice.fingerprintBlock,
              }),
              check({ seed: angle.angle, draft: editorResult.texts }),
            ]);

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

            totalCostUsd += angleCost;

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
            );

            if (factResult.claims.length > 0 && createdPosts[0]) {
              const claimRows = factResult.claims.slice(0, 20).map((c) => ({
                postId: createdPosts[0]!.id,
                claimText: c.text,
                verified: c.verdict === "supported",
                notes: `${c.verdict}: ${c.reason}`,
              }));
              try {
                await db.insert(claims).values(claimRows);
              } catch {
                // claims insert is non-critical
              }
            }

            const angleResult = {
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
            results.push(angleResult);

            controller.enqueue(
              sseEncode("angle_done", angleResult),
            );

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

            controller.enqueue(
              sseEncode("angle_error", {
                angleIndex: i,
                hook: angle.hook,
                message,
              }),
            );
          }
        }

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
