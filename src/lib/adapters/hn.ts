import "server-only";
import { db } from "@/db/client";
import { sources } from "@/db/schema";

const HN_TOP_URL = "https://hacker-news.firebaseio.com/v0/topstories.json";
const HN_ITEM_URL = "https://hacker-news.firebaseio.com/v0/item";

type HNItem = {
  id: number;
  title?: string;
  url?: string;
  text?: string;
  score?: number;
  by?: string;
  type?: string;
  descendants?: number;
};

export type HNFetchResult = {
  fetched: number;
  ingested: number;
  errors: string[];
};

export async function fetchHackerNews(opts?: {
  limit?: number;
  minScore?: number;
}): Promise<HNFetchResult> {
  const limit = opts?.limit ?? 15;
  const minScore = opts?.minScore ?? 50;
  const result: HNFetchResult = { fetched: 0, ingested: 0, errors: [] };

  let topIds: number[];
  try {
    const res = await fetch(HN_TOP_URL, { next: { revalidate: 0 } });
    topIds = (await res.json()) as number[];
  } catch (err) {
    result.errors.push(`top stories: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  const candidates = topIds.slice(0, limit * 2);

  for (const id of candidates) {
    if (result.fetched >= limit) break;
    try {
      const res = await fetch(`${HN_ITEM_URL}/${id}.json`, {
        next: { revalidate: 0 },
      });
      const item = (await res.json()) as HNItem;
      if (!item || item.type !== "story") continue;
      if ((item.score ?? 0) < minScore) continue;

      result.fetched++;
      const externalId = String(item.id);
      const url = item.url ?? `https://news.ycombinator.com/item?id=${item.id}`;

      await db
        .insert(sources)
        .values({
          type: "hn",
          externalId,
          url,
          title: item.title ?? "",
          content: item.text ?? "",
          meta: {
            score: item.score,
            by: item.by,
            comments: item.descendants,
          },
        })
        .onConflictDoUpdate({
          target: [sources.type, sources.externalId],
          set: {
            title: item.title ?? "",
            content: item.text ?? "",
            meta: {
              score: item.score,
              by: item.by,
              comments: item.descendants,
            },
          },
        });
      result.ingested++;
    } catch (err) {
      result.errors.push(`item ${id}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return result;
}
