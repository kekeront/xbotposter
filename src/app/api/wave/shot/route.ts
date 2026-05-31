import { requireUser } from "@/lib/auth";
import { checkSpendCap } from "@/lib/spend-cap";
import { writeTrace } from "@/lib/trace";
import { runWaveShot } from "@/lib/wave";

export const maxDuration = 120;

// On-demand "viral wave shot": recommend topics from the wave + writer-only
// previews. Returns the shots for review; promoting one is /api/wave/queue.
export async function POST() {
  const user = await requireUser();

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

  const result = await runWaveShot(user.id, { count: 3 });

  // Fold the shot cost into billing so the daily cap stays honest.
  await writeTrace({
    generationId: null,
    userId: user.id,
    agent: "wave-shot",
    eventType: result.shots.length > 0 ? "complete" : "skip",
    payload: { shots: result.shots.length, basedOn: result.basedOn },
    costUsd: result.totalCostUsd.toString(),
  }).catch(() => {});

  return Response.json(result);
}
