import { fetchArxiv, fetchHackerNews, fetchSubstackFeed } from "@/lib/adapters";
import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";
import { runDiscoverFetch } from "@/lib/discover";
import { checkSpendCap, spendCapResponse } from "@/lib/spend-cap";
import { writeTrace } from "@/lib/trace";

const SUBSTACK_FEEDS = [
  "simonwillison",
  "interconnects",
  "semianalysis",
];

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorized();

  const verdict = await checkSpendCap();
  if (!verdict.allow) return spendCapResponse(verdict);

  const [xResult, hnResult, arxivResult, ...substackResults] =
    await Promise.all([
      runDiscoverFetch({ source: "cron" }),
      fetchHackerNews({ limit: 15, minScore: 50 }).catch((err) => ({
        fetched: 0,
        ingested: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      })),
      fetchArxiv({ limit: 10 }).catch((err) => ({
        fetched: 0,
        ingested: 0,
        errors: [err instanceof Error ? err.message : String(err)],
      })),
      ...SUBSTACK_FEEDS.map((sub) =>
        fetchSubstackFeed(sub, { limit: 5 }).catch((err) => ({
          publication: sub,
          fetched: 0,
          ingested: 0,
          errors: [err instanceof Error ? err.message : String(err)],
        })),
      ),
    ]);

  await writeTrace({
    generationId: null,
    agent: "discover",
    eventType: "adapters_complete",
    payload: {
      hn: hnResult,
      arxiv: arxivResult,
      substack: substackResults,
    },
  });

  return Response.json({
    x: xResult,
    hn: hnResult,
    arxiv: arxivResult,
    substack: substackResults,
  });
}
