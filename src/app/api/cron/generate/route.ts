import { desc, eq, gt, sql } from "drizzle-orm";
import { review } from "@/agents/editor";
import { evaluate } from "@/agents/evaluator";
import { check } from "@/agents/fact-checker";
import { draft as takeDraft } from "@/agents/take";
import { check as guardCheck } from "@/agents/topic-guard";
import { db } from "@/db/client";
import { generations, posts, viralPosts } from "@/db/schema";
import { shouldAutoApprove } from "@/lib/auto-approve";
import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";
import { recallMemories } from "@/lib/recall";
import { checkSpendCap, spendCapResponse } from "@/lib/spend-cap";
import { sendDraftNotification } from "@/lib/telegram";
import { writeTrace } from "@/lib/trace";
import { loadDefaultVoice } from "@/lib/voice-load";

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorized();

  const verdict = await checkSpendCap();
  if (!verdict.allow) return spendCapResponse(verdict);

  const sub48h = new Date(Date.now() - 48 * 3600 * 1000);
  const sub7d = new Date(Date.now() - 7 * 24 * 3600 * 1000);

  const recent = await db
    .select()
    .from(viralPosts)
    .where(gt(viralPosts.capturedAt, sub48h))
    .orderBy(
      desc(sql<number>`coalesce((${viralPosts.engagement}->>'likes')::int, 0)`),
    )
    .limit(20);

  if (recent.length === 0) {
    await writeTrace({
      generationId: null,
      agent: "cron-generate",
      eventType: "skip",
      payload: { reason: "no viral posts captured in last 48h" },
    });
    return Response.json({ ok: true, skipped: "no recent viral posts" });
  }

  const takenRows = await db
    .select({
      vid: sql<string>`${generations.inputMeta}->>'viralPostId'`,
    })
    .from(generations)
    .where(gt(generations.createdAt, sub7d));
  const takenIds = new Set(takenRows.map((t) => t.vid).filter(Boolean));

  // Pick the highest-engagement candidate that (a) hasn't been processed in
  // the last 7d and (b) passes the topic safety gate. Walk down the top list
  // until one passes — political/tragic/conspiracy tweets get filtered here
  // and don't waste downstream tokens or risk the queue.
  let candidate: (typeof recent)[number] | null = null;
  const blockedCategories: Array<{ author: string; category: string }> = [];
  for (const v of recent) {
    if (takenIds.has(v.id)) continue;
    const guard = await guardCheck({ text: v.text, author: v.author });
    await writeTrace({
      generationId: null,
      agent: "topic-guard",
      eventType: guard.safe ? "safe" : "blocked",
      payload: {
        viralPostId: v.id,
        viralAuthor: v.author,
        category: guard.category,
        reason: guard.reason,
        mode: "cron-generate",
      },
      model: guard.model,
      tokensIn: guard.tokensIn,
      tokensOut: guard.tokensOut,
      costUsd: guard.costUsd.toString(),
    });
    if (guard.safe) {
      candidate = v;
      break;
    }
    blockedCategories.push({
      author: v.author ?? "?",
      category: guard.category,
    });
  }

  if (!candidate) {
    await writeTrace({
      generationId: null,
      agent: "cron-generate",
      eventType: "skip",
      payload: {
        reason: "no safe candidates after topic-guard filter",
        considered: recent.length,
        blocked: blockedCategories,
      },
    });
    return Response.json({
      ok: true,
      skipped: "no brand-safe viral candidates",
      consideredCount: recent.length,
      blocked: blockedCategories,
    });
  }

  const author = candidate.author ?? "unknown";

  await writeTrace({
    generationId: null,
    agent: "cron-generate",
    eventType: "picked",
    payload: {
      viralId: candidate.id,
      viralAuthor: author,
      likes:
        (candidate.engagement as { likes?: number } | null)?.likes ?? null,
    },
  });

  const [generation] = await db
    .insert(generations)
    .values({
      topic: `autonomous take on @${author}: ${candidate.text.slice(0, 100)}`,
      inputMeta: {
        contentType: "single",
        mode: "take",
        source: "cron",
        viralPostId: candidate.id,
        viralAuthor: author,
        viralXTweetId: candidate.xTweetId,
        viralXUrl: candidate.xUrl,
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

  try {
    const voice = await loadDefaultVoice();
    const recall = await recallMemories({ query: candidate.text });
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
      viralText: candidate.text,
      viralAuthor: author,
      contentType: "single",
      referenceTweets: voice.referenceTweets,
      fingerprintBlock: voice.fingerprintBlock,
      memoryBlock: recall.promptBlock,
    });
    const editorResult = await review({
      topic: `Reacting to @${author}: ${candidate.text}`,
      drafts: writerResult.texts,
      contentType: "single",
      referenceTweets: voice.referenceTweets,
      fingerprintBlock: voice.fingerprintBlock,
    });
    const [evalResult, factResult] = await Promise.all([
      evaluate({
        seed: `Reacting to @${author}: ${candidate.text}`,
        draft: editorResult.texts,
        contentType: "single",
        referenceTweets: voice.referenceTweets,
        fingerprintBlock: voice.fingerprintBlock,
      }),
      check({
        seed: `Reacting to @${author}: ${candidate.text}`,
        draft: editorResult.texts,
      }),
    ]);

    const totalIn =
      writerResult.tokensIn +
      editorResult.tokensIn +
      evalResult.tokensIn +
      factResult.tokensIn;
    const totalOut =
      writerResult.tokensOut +
      editorResult.tokensOut +
      evalResult.tokensOut +
      factResult.tokensOut;
    const totalCost =
      writerResult.costUsd +
      editorResult.costUsd +
      evalResult.costUsd +
      factResult.costUsd;

    await db
      .update(generations)
      .set({
        status: "succeeded",
        model: `${writerResult.model} + ${editorResult.model} + ${evalResult.model}`,
        inputMeta: {
          contentType: "single",
          mode: "take",
          source: "cron",
          viralPostId: candidate.id,
          viralAuthor: author,
          viralXTweetId: candidate.xTweetId,
          viralXUrl: candidate.xUrl,
          eval: {
            overall: evalResult.overall,
            scores: evalResult.scores,
            critique: evalResult.critique,
          },
          factCheck: {
            claimsCount: factResult.claims.length,
            invented: factResult.inventedCount,
          },
        },
        tokensIn: totalIn,
        tokensOut: totalOut,
        costUsd: totalCost.toString(),
        completedAt: new Date(),
      })
      .where(eq(generations.id, generation.id));

    const text = editorResult.texts[0] ?? writerResult.texts[0];
    if (!text) {
      return Response.json(
        { error: "no text produced" },
        { status: 500 },
      );
    }

    const verdict = shouldAutoApprove({
      mode: "take",
      contentType: "single",
      text,
      evaluation: { overall: evalResult.overall, scores: evalResult.scores },
      factCheck: { inventedCount: factResult.inventedCount },
    });

    const [insertedPost] = await db
      .insert(posts)
      .values({
        generationId: generation.id,
        contentType: "single",
        text,
        status: verdict.eligible ? "approved" : "draft",
        scheduledFor: verdict.eligible ? verdict.scheduledFor : null,
      })
      .returning();

    await writeTrace({
      generationId: generation.id,
      agent: "auto-approve",
      eventType: verdict.eligible ? "approved" : "held_for_review",
      payload: {
        postId: insertedPost?.id,
        reason: verdict.reason,
        scheduledFor: verdict.eligible
          ? verdict.scheduledFor.toISOString()
          : null,
        evalOverall: evalResult.overall,
        stance: evalResult.scores.stance,
        inventedClaims: factResult.inventedCount,
      },
    });

    // Fire-and-forget Telegram notification. No await — autonomous run
    // shouldn't block on bot API delays. Silently no-op if not configured.
    if (insertedPost) {
      void sendDraftNotification({
        postId: insertedPost.id,
        text,
        sourceLabel: `autonomous take on @${author}`,
        evalOverall: evalResult.overall,
        autoApprovedFor: verdict.eligible ? verdict.scheduledFor : null,
      });
    }

    return Response.json({
      ok: true,
      generated: {
        generationId: generation.id,
        postId: insertedPost?.id,
        viralAuthor: author,
        viralXUrl: candidate.xUrl,
        evalOverall: evalResult.overall,
        stanceScore: evalResult.scores.stance,
        inventedClaims: factResult.inventedCount,
        autoApproved: verdict.eligible,
        autoApproveReason: verdict.reason,
        scheduledFor: verdict.eligible ? verdict.scheduledFor : null,
        costUsd: totalCost,
      },
    });
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
      agent: "cron-generate",
      eventType: "error",
      payload: { message },
    });
    return Response.json(
      { error: "autonomous generation failed", message },
      { status: 500 },
    );
  }
}
