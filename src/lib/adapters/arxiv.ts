import "server-only";
import { db } from "@/db/client";
import { sources } from "@/db/schema";
import { env } from "@/lib/env";

const ARXIV_API = "https://export.arxiv.org/api/query";

type ArxivEntry = {
  id: string;
  title: string;
  summary: string;
  authors: string[];
  published: string;
  url: string;
  categories: string[];
};

export type ArxivFetchResult = {
  fetched: number;
  ingested: number;
  errors: string[];
};

function parseAtomFeed(xml: string): ArxivEntry[] {
  const entries: ArxivEntry[] = [];
  const entryRegex = /<entry>([\s\S]*?)<\/entry>/g;
  let match;

  while ((match = entryRegex.exec(xml)) !== null) {
    const block = match[1] ?? "";

    const id = block.match(/<id>(.*?)<\/id>/)?.[1]?.replace("http://arxiv.org/abs/", "") ?? "";
    const title = block.match(/<title>([\s\S]*?)<\/title>/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const summary = block.match(/<summary>([\s\S]*?)<\/summary>/)?.[1]?.replace(/\s+/g, " ").trim() ?? "";
    const published = block.match(/<published>(.*?)<\/published>/)?.[1] ?? "";

    const authors: string[] = [];
    const authorRegex = /<author>\s*<name>(.*?)<\/name>/g;
    let authorMatch;
    while ((authorMatch = authorRegex.exec(block)) !== null) {
      if (authorMatch[1]) authors.push(authorMatch[1]);
    }

    const categories: string[] = [];
    const catRegex = /<category[^>]*term="([^"]+)"/g;
    let catMatch;
    while ((catMatch = catRegex.exec(block)) !== null) {
      if (catMatch[1]) categories.push(catMatch[1]);
    }

    const url = `https://arxiv.org/abs/${id}`;
    entries.push({ id, title, summary, authors, published, url, categories });
  }

  return entries;
}

export async function fetchArxiv(opts?: {
  /** Override the arXiv search_query string. Falls back to ARXIV_CATEGORIES env var,
   *  then to the hardcoded default "cat:cs.AI+OR+cat:cs.CL+OR+cat:cs.LG". */
  query?: string;
  limit?: number;
}): Promise<ArxivFetchResult> {
  const query = opts?.query ?? env.ARXIV_CATEGORIES;
  const limit = opts?.limit ?? 15;
  const result: ArxivFetchResult = { fetched: 0, ingested: 0, errors: [] };

  try {
    const params = new URLSearchParams({
      search_query: query,
      start: "0",
      max_results: String(limit),
      sortBy: "submittedDate",
      sortOrder: "descending",
    });
    const res = await fetch(`${ARXIV_API}?${params}`, {
      next: { revalidate: 0 },
    });
    const xml = await res.text();
    const entries = parseAtomFeed(xml);
    result.fetched = entries.length;

    for (const entry of entries) {
      try {
        await db
          .insert(sources)
          .values({
            type: "arxiv",
            externalId: entry.id,
            url: entry.url,
            title: entry.title,
            content: entry.summary,
            meta: {
              authors: entry.authors,
              published: entry.published,
              categories: entry.categories,
            },
          })
          .onConflictDoUpdate({
            target: [sources.type, sources.externalId],
            set: {
              title: entry.title,
              content: entry.summary,
              meta: {
                authors: entry.authors,
                published: entry.published,
                categories: entry.categories,
              },
            },
          });
        result.ingested++;
      } catch (err) {
        result.errors.push(
          `${entry.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(
      `arxiv query: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}
