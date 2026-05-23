import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";
import { runDiscoverFetch } from "@/lib/discover";
import { checkSpendCap, spendCapResponse } from "@/lib/spend-cap";

// Vercel Cron sends GET. See vercel.json for the schedule.
export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorized();

  const verdict = await checkSpendCap();
  if (!verdict.allow) return spendCapResponse(verdict);

  const result = await runDiscoverFetch({ source: "cron" });
  return Response.json(result);
}
