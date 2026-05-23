import "server-only";
import { env } from "./env";
import { loadBilling } from "./billing";

export type SpendCapVerdict =
  | { allow: true; todayUsd: number; capUsd: number }
  | {
      allow: false;
      reason: string;
      todayUsd: number;
      capUsd: number;
    };

/** Used by cron endpoints to bail if today's spend exceeds MAX_DAILY_USD. */
export async function checkSpendCap(): Promise<SpendCapVerdict> {
  const capUsd = env.MAX_DAILY_USD;
  const snapshot = await loadBilling();
  if (!snapshot) {
    // If billing can't be computed, fail-OPEN so cron isn't bricked by an
    // unrelated DB hiccup. The cap is best-effort safety, not correctness.
    return { allow: true, todayUsd: 0, capUsd };
  }
  const todayUsd = snapshot.today.totalUsd;
  if (todayUsd >= capUsd) {
    return {
      allow: false,
      reason: `daily spend cap hit ($${todayUsd.toFixed(3)} / $${capUsd.toFixed(2)})`,
      todayUsd,
      capUsd,
    };
  }
  return { allow: true, todayUsd, capUsd };
}

export function spendCapResponse(verdict: SpendCapVerdict): Response {
  if (verdict.allow) {
    throw new Error("spendCapResponse called with allow=true verdict");
  }
  return Response.json(
    {
      ok: false,
      skipped: verdict.reason,
      todayUsd: verdict.todayUsd,
      capUsd: verdict.capUsd,
    },
    { status: 429 },
  );
}
