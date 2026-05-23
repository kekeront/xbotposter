import { z } from "zod";
import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";
import { extractMemoriesFromPost } from "@/lib/memory-extract";
import { checkSpendCap, spendCapResponse } from "@/lib/spend-cap";
import { writeTrace } from "@/lib/trace";

// Bootstrap memory layer from a dump of historical posts. The user pastes
// Telegram channel exports, raw tweets, or any short-form writing. Each
// item is fed through the extractor with outcome="telegram_seed" so the
// resulting memories carry the right source_kind.
//
// Cost: ~$0.0005 per item with gpt-5-mini, so a 50-post seed = ~$0.025.
// Capped at 50 items per request to bound spend.

const SeedRequest = z.object({
  posts: z
    .array(
      z.object({
        text: z.string().min(1).max(4000),
        topic: z.string().max(500).optional(),
      }),
    )
    .min(1)
    .max(50),
});

export async function POST(request: Request) {
  // Same Bearer auth as cron — protects the deployed URL from anonymous
  // spammers. Local seed script reads CRON_SECRET from .env.local.
  if (!authorizeCronRequest(request)) return unauthorized();

  const cap = await checkSpendCap();
  if (!cap.allow) return spendCapResponse(cap);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "invalid json" }, { status: 400 });
  }

  const parsed = SeedRequest.safeParse(body);
  if (!parsed.success) {
    return Response.json(
      { error: "invalid payload", details: parsed.error.flatten() },
      { status: 400 },
    );
  }
  const { posts } = parsed.data;

  const startedAt = Date.now();
  const results: Array<{
    index: number;
    extracted: number;
    recorded: number;
    costUsd: number;
    error?: string;
  }> = [];

  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (!p) continue;
    try {
      const r = await extractMemoriesFromPost({
        postText: p.text,
        topic: p.topic ?? null,
        outcome: "telegram_seed",
        sourceId: null,
      });
      results.push({
        index: i,
        extracted: r.extracted.length,
        recorded: r.recorded,
        costUsd: r.costUsd,
      });
    } catch (err) {
      results.push({
        index: i,
        extracted: 0,
        recorded: 0,
        costUsd: 0,
        error: err instanceof Error ? err.message : "unknown",
      });
    }
  }

  const totalRecorded = results.reduce((s, r) => s + r.recorded, 0);
  const totalCost = results.reduce((s, r) => s + r.costUsd, 0);
  const failures = results.filter((r) => r.error).length;

  await writeTrace({
    generationId: null,
    agent: "memory-seed",
    eventType: "complete",
    payload: {
      inputCount: posts.length,
      recorded: totalRecorded,
      failures,
      ms: Date.now() - startedAt,
    },
    costUsd: totalCost.toString(),
  });

  return Response.json({
    ok: true,
    processed: posts.length,
    recorded: totalRecorded,
    failures,
    costUsd: totalCost,
    results,
  });
}
