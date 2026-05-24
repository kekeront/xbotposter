import "server-only";
import { db } from "@/db/client";
import { sources } from "@/db/schema";

type SubstackPost = {
  id: number;
  title: string;
  subtitle: string;
  slug: string;
  post_date: string;
  canonical_url: string;
  description: string;
};

export type SubstackFetchResult = {
  publication: string;
  fetched: number;
  ingested: number;
  errors: string[];
};

export async function fetchSubstackFeed(
  subdomain: string,
  opts?: { limit?: number },
): Promise<SubstackFetchResult> {
  const limit = opts?.limit ?? 10;
  const result: SubstackFetchResult = {
    publication: subdomain,
    fetched: 0,
    ingested: 0,
    errors: [],
  };

  try {
    const res = await fetch(
      `https://${subdomain}.substack.com/api/v1/posts?limit=${limit}`,
      { next: { revalidate: 0 } },
    );
    if (!res.ok) {
      result.errors.push(`${subdomain}: HTTP ${res.status}`);
      return result;
    }

    const posts = (await res.json()) as SubstackPost[];
    result.fetched = posts.length;

    for (const post of posts) {
      const externalId = `${subdomain}/${post.id}`;
      try {
        await db
          .insert(sources)
          .values({
            type: "substack",
            externalId,
            url: post.canonical_url,
            title: post.title,
            content: post.subtitle || post.description || "",
            meta: {
              publication: subdomain,
              slug: post.slug,
              postDate: post.post_date,
            },
          })
          .onConflictDoUpdate({
            target: [sources.type, sources.externalId],
            set: {
              title: post.title,
              content: post.subtitle || post.description || "",
              url: post.canonical_url,
            },
          });
        result.ingested++;
      } catch (err) {
        result.errors.push(
          `${externalId}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  } catch (err) {
    result.errors.push(
      `${subdomain}: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return result;
}
