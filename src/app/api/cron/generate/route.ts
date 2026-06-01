import { desc, eq, gt, sql } from "drizzle-orm";
import { review } from "@/agents/editor";
import { evaluate } from "@/agents/evaluator";
import { check } from "@/agents/fact-checker";
import { search as searchWeb } from "@/agents/searcher";
import { draft as takeDraft } from "@/agents/take";
import { draft as writerDraft } from "@/agents/writer";
import { check as guardCheck } from "@/agents/topic-guard";
import { db } from "@/db/client";
import { claims, generations, posts, sources, viralPosts } from "@/db/schema";
import {
  persistSearchSources,
  buildSourceUrlToIdMap,
} from "@/lib/source-persist";
import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";
import { checkSpendCap, spendCapResponse } from "@/lib/spend-cap";
import { sendDraftNotification } from "@/lib/telegram";
import { writeTrace } from "@/lib/trace";
import { loadDefaultVoice } from "@/lib/voice-load";

// Long-running autonomous job — pin the function budget so a slow run isn't
// killed at the platform default (which would orphan in-flight work).
export const maxDuration = 300;

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
      eventType: "no_viral",
      payload: { reason: "no viral posts captured in last 48h, will try sources" },
    });
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

  // --- Source-based fallback: if no viral candidate, try HN/arXiv/Substack ---
  type SourceCandidate = {
    id: string;
    title: string;
    url: string | null;
    content: string | null;
    type: string;
  };
  let sourceCandidate: SourceCandidate | null = null;

  if (!candidate) {
    const takenSourceIds = await db
      .select({
        sid: sql<string>`${generations.inputMeta}->>'sourceId'`,
      })
      .from(generations)
      .where(gt(generations.createdAt, sub7d));
    const takenSIds = new Set(
      takenSourceIds.map((t) => t.sid).filter(Boolean),
    );

    const recentSources = await db
      .select()
      .from(sources)
      .where(
        gt(sources.ingestedAt, sub48h),
      )
      .orderBy(desc(sources.ingestedAt))
      .limit(20);

    for (const s of recentSources) {
      if (takenSIds.has(s.id)) continue;
      if (!s.title) continue;
      const guard = await guardCheck({ text: `${s.title} ${s.content ?? ""}`.slice(0, 500), author: s.type });
      if (guard.safe) {
        sourceCandidate = {
          id: s.id,
          title: s.title,
          url: s.url,
          content: s.content,
          type: s.type,
        };
        break;
      }
    }
  }

  if (!candidate && !sourceCandidate) {
    await writeTrace({
      generationId: null,
      agent: "cron-generate",
      eventType: "skip",
      payload: {
        reason: "no safe candidates from viral posts or sources",
        viralConsidered: recent.length,
        blocked: blockedCategories,
      },
    });
    return Response.json({
      ok: true,
      skipped: "no brand-safe candidates (viral or sources)",
      consideredCount: recent.length,
      blocked: blockedCategories,
    });
  }

  const isSourceBased = !candidate && !!sourceCandidate;
  const author = candidate ? (candidate.author ?? "unknown") : sourceCandidate!.type;
  const topicText = candidate
    ? candidate.text
    : `${sourceCandidate!.title}: ${(sourceCandidate!.content ?? "").slice(0, 200)}`;

  await writeTrace({
    generationId: null,
    agent: "cron-generate",
    eventType: "picked",
    payload: isSourceBased
      ? {
          sourceId: sourceCandidate!.id,
          sourceType: sourceCandidate!.type,
          sourceTitle: sourceCandidate!.title,
          mode: "source",
        }
      : {
          viralId: candidate!.id,
          viralAuthor: author,
          likes:
            (candidate!.engagement as { likes?: number } | null)?.likes ?? null,
          mode: "viral",
        },
  });

  const generationTopic = isSourceBased
    ? `autonomous post on ${sourceCandidate!.type}: ${sourceCandidate!.title.slice(0, 100)}`
    : `autonomous take on @${author}: ${candidate!.text.slice(0, 100)}`;

  const [generation] = await db
    .insert(generations)
    .values({
      topic: generationTopic,
      inputMeta: isSourceBased
        ? {
            contentType: "single",
            mode: "source-compose",
            source: "cron",
            sourceId: sourceCandidate!.id,
            sourceType: sourceCandidate!.type,
            sourceTitle: sourceCandidate!.title,
            sourceUrl: sourceCandidate!.url,
          }
        : {
            contentType: "single",
            mode: "take",
            source: "cron",
            viralPostId: candidate!.id,
            viralAuthor: author,
            viralXTweetId: candidate!.xTweetId,
            viralXUrl: candidate!.xUrl,
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

    let researchBlock = "";
    let sourceUrlToId = new Map<string, string>();
    let searchCost = 0;
    try {
      const searchResult = await searchWeb({ topic: topicText.slice(0, 500) });
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
    } catch (err) {
      await writeTrace({
        generationId: generation.id,
        agent: "searcher",
        eventType: "error",
        payload: {
          message: err instanceof Error ? err.message : String(err),
        },
      });
    }

    const writerResult = isSourceBased
      ? await writerDraft({
          topic: topicText,
          contentType: "single",
          referenceTweets: voice.referenceTweets,
          fingerprintBlock: voice.fingerprintBlock,
          researchBlock,
        })
      : await takeDraft({
          viralText: candidate!.text,
          viralAuthor: author,
          contentType: "single",
          referenceTweets: voice.referenceTweets,
          fingerprintBlock: voice.fingerprintBlock,
          researchBlock,
        });
    const editorSeed = generationTopic;
    const editorResult = await review({
      topic: editorSeed,
      drafts: writerResult.texts,
      contentType: "single",
      referenceTweets: voice.referenceTweets,
      fingerprintBlock: voice.fingerprintBlock,
    });
    const [evalResult, factResult] = await Promise.all([
      evaluate({
        seed: editorSeed,
        draft: editorResult.texts,
        contentType: "single",
        referenceTweets: voice.referenceTweets,
        fingerprintBlock: voice.fingerprintBlock,
      }),
      check({
        seed: editorSeed,
        draft: editorResult.texts,
        researchBlock,
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
      searchCost +
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
          ...(generation.inputMeta as Record<string, unknown>),
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

    const [insertedPost] = await db
      .insert(posts)
      .values({
        generationId: generation.id,
        contentType: "single",
        text,
        status: "draft",
      })
      .returning();

    if (factResult.claims.length > 0 && insertedPost) {
      const claimRows = factResult.claims.slice(0, 20).map((c) => ({
        postId: insertedPost.id,
        claimText: c.text,
        sourceId: c.sourceUrl ? sourceUrlToId.get(c.sourceUrl) ?? null : null,
        verified: c.verdict === "supported",
        notes: `${c.verdict}: ${c.reason}`,
      }));
      try {
        await db.insert(claims).values(claimRows);
      } catch {
        // best-effort
      }
    }

    if (insertedPost) {
      const sourceLabel = isSourceBased
        ? `autonomous post from ${sourceCandidate!.type}: ${sourceCandidate!.title.slice(0, 60)}`
        : `autonomous take on @${author}`;
      void sendDraftNotification({
        postId: insertedPost.id,
        text,
        sourceLabel,
        evalOverall: evalResult.overall,
      });
    }

    return Response.json({
      ok: true,
      generated: {
        generationId: generation.id,
        postId: insertedPost?.id,
        mode: isSourceBased ? "source-compose" : "take",
        source: isSourceBased
          ? { type: sourceCandidate!.type, title: sourceCandidate!.title }
          : { author, xUrl: candidate!.xUrl },
        evalOverall: evalResult.overall,
        inventedClaims: factResult.inventedCount,
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
