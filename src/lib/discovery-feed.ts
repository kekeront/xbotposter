import "server-only";
import { and, ilike, isNull, or, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { sources, viralPosts } from "@/db/schema";

// ─── Public Types ─────────────────────────────────────────────────────────────

export type DiscoveryKind =
  | "x"
  | "hn"
  | "arxiv"
  | "substack"
  | "manual"
  | "pdf"
  | "image";

export type DiscoveryItem = {
  /** UUID of the row in viralPosts or sources */
  id: string;
  kind: DiscoveryKind;
  title: string | null;
  text: string;
  url: string | null;
  author: string | null;
  /** Engagement-derived relevance score */
  score: number;
  capturedAt: Date;
  /** Which table the row came from */
  source: "viral" | "source";
  /** Same as `id` — retained so callers have an explicit handle for take/qrt actions */
  refId: string;
};

export type DiscoveryFilters = {
  kinds?: DiscoveryKind[];
  query?: string;
  sort?: "recency" | "engagement";
  limit?: number;
  offset?: number;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** The SOURCE_TYPE values that are valid DiscoveryKind values. */
const VALID_SOURCE_KINDS = new Set<string>([
  "hn",
  "arxiv",
  "substack",
  "x",
  "manual",
  "pdf",
  "image",
]);

function isDiscoveryKind(value: string): value is DiscoveryKind {
  return (
    value === "x" ||
    value === "hn" ||
    value === "arxiv" ||
    value === "substack" ||
    value === "manual" ||
    value === "pdf" ||
    value === "image"
  );
}

/** Safely read an integer from a jsonb-sourced value. */
function safeInt(value: unknown): number {
  const n = Number(value);
  return Number.isFinite(n) ? Math.floor(n) : 0;
}

// ─── Loaders ─────────────────────────────────────────────────────────────────

async function loadViralRows(
  userId: string,
  query: string | undefined,
): Promise<DiscoveryItem[]> {
  const conditions = [
    // Include rows owned by this user OR global rows (userId IS NULL).
    or(
      sql`${viralPosts.userId} = ${userId}::uuid`,
      isNull(viralPosts.userId),
    ),
  ];

  if (query) {
    const pattern = `%${query}%`;
    conditions.push(
      or(
        ilike(viralPosts.text, pattern),
        ilike(viralPosts.author, pattern),
      ),
    );
  }

  const rows = await db
    .select({
      id: viralPosts.id,
      text: viralPosts.text,
      url: viralPosts.xUrl,
      author: viralPosts.author,
      engagement: viralPosts.engagement,
      capturedAt: viralPosts.capturedAt,
    })
    .from(viralPosts)
    .where(and(...conditions));

  return rows.map((r) => {
    const score = safeInt(r.engagement?.likes);
    return {
      id: r.id,
      kind: "x" as const,
      title: null,
      text: r.text,
      url: r.url ?? null,
      author: r.author ?? null,
      score,
      capturedAt: r.capturedAt,
      source: "viral" as const,
      refId: r.id,
    };
  });
}

async function loadSourceRows(
  userId: string,
  query: string | undefined,
): Promise<DiscoveryItem[]> {
  const conditions = [
    or(
      sql`${sources.userId} = ${userId}::uuid`,
      isNull(sources.userId),
    ),
  ];

  if (query) {
    const pattern = `%${query}%`;
    conditions.push(
      or(
        ilike(sources.title, pattern),
        ilike(sources.content, pattern),
      ),
    );
  }

  const rows = await db
    .select({
      id: sources.id,
      type: sources.type,
      title: sources.title,
      content: sources.content,
      url: sources.url,
      meta: sources.meta,
      ingestedAt: sources.ingestedAt,
    })
    .from(sources)
    .where(and(...conditions));

  const items: DiscoveryItem[] = [];
  for (const r of rows) {
    // Filter out source types that don't map to a DiscoveryKind (e.g. "web").
    if (!VALID_SOURCE_KINDS.has(r.type)) continue;
    if (!isDiscoveryKind(r.type)) continue;

    const score = safeInt(r.meta?.score);
    items.push({
      id: r.id,
      kind: r.type,
      title: r.title ?? null,
      text: r.content ?? "",
      url: r.url ?? null,
      author: null,
      score,
      capturedAt: r.ingestedAt,
      source: "source" as const,
      refId: r.id,
    });
  }
  return items;
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Load the discovery feed for a given user.
 *
 * Merges rows from `viralPosts` (kind 'x') and `sources` (kind = source type),
 * including globally-captured rows where userId IS NULL. Applies optional
 * keyword search, kind filter, and sort before returning a paginated slice.
 *
 * @param userId  The authenticated user's UUID.
 * @param filters Optional filter/sort/pagination parameters.
 * @returns       `{ items, total }` — `total` is the count before pagination.
 */
export async function loadDiscoveryFeed(
  userId: string,
  filters?: DiscoveryFilters,
): Promise<{ items: DiscoveryItem[]; total: number }> {
  const {
    kinds,
    query,
    sort = "recency",
    limit = 30,
    offset = 0,
  } = filters ?? {};

  // Fetch both tables in parallel.
  const [viralItems, sourceItems] = await Promise.all([
    loadViralRows(userId, query),
    loadSourceRows(userId, query),
  ]);

  let merged: DiscoveryItem[] = [...viralItems, ...sourceItems];

  // Apply kind filter in JS (data volumes are small — tens to hundreds of rows).
  if (kinds && kinds.length > 0) {
    const kindSet = new Set<string>(kinds);
    merged = merged.filter((item) => kindSet.has(item.kind));
  }

  const total = merged.length;

  // Sort.
  if (sort === "engagement") {
    merged.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.capturedAt.getTime() - a.capturedAt.getTime();
    });
  } else {
    // Default: recency descending.
    merged.sort(
      (a, b) => b.capturedAt.getTime() - a.capturedAt.getTime(),
    );
  }

  // Paginate.
  const items = merged.slice(offset, offset + limit);

  return { items, total };
}
