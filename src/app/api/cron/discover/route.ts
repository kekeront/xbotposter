import { fetchArxiv, fetchHackerNews, fetchSubstackFeed } from "@/lib/adapters";
import { authorizeCronRequest, unauthorized } from "@/lib/cron-auth";
import { runDiscoverFetch } from "@/lib/discover";
import { env } from "@/lib/env";
import { checkSpendCap, spendCapResponse } from "@/lib/spend-cap";
import { writeTrace } from "@/lib/trace";
import { db } from "@/db/client";
import { profiles } from "@/db/schema";
import type { TrackedAccount } from "@/db/schema";
import type { Influencer } from "@/config/influencers";

const SUBSTACK_FEEDS = [
  "simonwillison",
  "interconnects",
  "semianalysis",
];

/** Load all profiles that have tracked accounts set and merge them into a
 *  single deduplicated list (by lowercase username). The app is effectively
 *  single-user, but this is future-safe. */
async function loadTrackedAccounts(): Promise<Influencer[]> {
  const rows = await db
    .select({ trackedAccounts: profiles.trackedAccounts })
    .from(profiles);

  const seen = new Set<string>();
  const merged: Influencer[] = [];

  for (const row of rows) {
    const accounts = row.trackedAccounts;
    if (!accounts || accounts.length === 0) continue;
    for (const acc of accounts as TrackedAccount[]) {
      const key = acc.username.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push({
        username: acc.username,
        name: acc.name,
        topic: acc.topic,
        id: acc.id,
      });
    }
  }

  return merged;
}

// Long-running autonomous job — pin the function budget so a slow run isn't
// killed at the platform default (which would orphan in-flight work).
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!authorizeCronRequest(request)) return unauthorized();

  const verdict = await checkSpendCap();
  if (!verdict.allow) return spendCapResponse(verdict);

  // Load per-user tracked accounts; falls back to INFLUENCERS inside
  // runDiscoverFetch when the result is empty.
  const trackedAccounts = await loadTrackedAccounts();

  const [xResult, hnResult, arxivResult, ...substackResults] =
    await Promise.all([
      runDiscoverFetch({
        source: "cron",
        accounts: trackedAccounts.length > 0 ? trackedAccounts : undefined,
      }),
      fetchHackerNews({ limit: 15, minScore: env.HN_MIN_SCORE }).catch((err) => ({
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
