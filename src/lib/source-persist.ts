import "server-only";
import { desc, gt } from "drizzle-orm";
import { db } from "@/db/client";
import { sources, type Source, type SourceType } from "@/db/schema";
import type { SearchSource } from "@/agents/searcher";

export async function persistSearchSources(
  searchSources: SearchSource[],
): Promise<Source[]> {
  if (searchSources.length === 0) return [];

  const persisted: Source[] = [];
  for (const s of searchSources) {
    const externalId = s.url;
    try {
      const [row] = await db
        .insert(sources)
        .values({
          type: "web",
          externalId,
          url: s.url,
          title: s.title,
          content: s.snippet,
        })
        .onConflictDoUpdate({
          target: [sources.type, sources.externalId],
          set: { title: s.title, content: s.snippet },
        })
        .returning();
      if (row) persisted.push(row);
    } catch {
      // best-effort — don't break the pipeline for a source insert failure
    }
  }
  return persisted;
}

export function buildSourceUrlToIdMap(
  persistedSources: Source[],
): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of persistedSources) {
    if (s.url) map.set(s.url, s.id);
  }
  return map;
}

export async function fetchRecentUploadedSources(opts?: {
  types?: SourceType[];
  limit?: number;
  hoursBack?: number;
}): Promise<Source[]> {
  const types = opts?.types ?? ["manual", "hn", "arxiv", "substack"];
  const limit = opts?.limit ?? 10;
  const hoursBack = opts?.hoursBack ?? 72;
  const since = new Date(Date.now() - hoursBack * 3600 * 1000);

  return db
    .select()
    .from(sources)
    .where(
      gt(sources.ingestedAt, since),
    )
    .orderBy(desc(sources.ingestedAt))
    .limit(limit * 2)
    .then((rows) =>
      rows
        .filter((r) => types.includes(r.type as SourceType))
        .slice(0, limit),
    );
}

export function buildSourceContextBlock(uploadedSources: Source[]): string {
  if (uploadedSources.length === 0) return "";
  const items = uploadedSources.map((s) => {
    const title = s.title ?? "Untitled";
    const snippet = (s.content ?? "").slice(0, 300);
    const url = s.url ? ` (${s.url})` : "";
    return `- [${s.type}] ${title}${url}: ${snippet}`;
  });
  return `UPLOADED CONTEXT — recent sources from your library:\n${items.join("\n")}`;
}
