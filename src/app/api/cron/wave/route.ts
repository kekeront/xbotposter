import { db } from "@/db/client";
import { generations, posts, profiles } from "@/db/schema";
import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";
import { checkSpendCap, spendCapResponse } from "@/lib/spend-cap";
import { writeTrace } from "@/lib/trace";
import { runWaveShot } from "@/lib/wave";

// Long-running autonomous job — pin the budget so a slow run isn't killed.
export const maxDuration = 300;

// Autonomous "viral wave shot": recommend topics from the wave + writer-only
// drafts, dropped into the queue (status "draft") for human review. Lighter
// than cron/generate by design — the wave shot is fast/raw on purpose.
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorized();

  const verdict = await checkSpendCap();
  if (!verdict.allow) return spendCapResponse(verdict);

  // Cron has no session; attribute to the primary profile (single-user app).
  const [profile] = await db.select({ id: profiles.id }).from(profiles).limit(1);
  if (!profile) {
    return Response.json({ ok: true, skipped: "no profile" });
  }

  const result = await runWaveShot(profile.id, { count: 2 });

  let created = 0;
  for (const shot of result.shots) {
    const text = shot.texts[0] ?? "";
    if (!text) continue;
    const [generation] = await db
      .insert(generations)
      .values({
        userId: profile.id,
        topic: shot.topic,
        inputMeta: { source: "cron", mode: "wave-shot", hook: shot.hook },
        status: "succeeded",
        model: shot.model,
        tokensIn: 0,
        tokensOut: 0,
        costUsd: shot.costUsd.toString(),
        completedAt: new Date(),
      })
      .returning();
    if (!generation) continue;
    await db.insert(posts).values({
      userId: profile.id,
      generationId: generation.id,
      contentType: "single",
      text,
      status: "draft",
    });
    created += 1;
  }

  await writeTrace({
    generationId: null,
    agent: "cron-wave",
    eventType: created > 0 ? "complete" : "skip",
    payload: { shots: result.shots.length, created, basedOn: result.basedOn },
    costUsd: result.totalCostUsd.toString(),
  }).catch(() => {});

  return Response.json({
    ok: true,
    generated: created,
    basedOn: result.basedOn,
  });
}
