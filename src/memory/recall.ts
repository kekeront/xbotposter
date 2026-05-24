import "server-only";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { embed } from "@/lib/llm";
import {
  type MemoryType,
  memDocuments,
  memEmbeddings,
  memMemories,
  memTurns,
} from "./schema";

// §3 POST /recall equivalent. Builds the reference context an agent should
// see before generating its next post.
//
// 5 steps under one `maxTokens` budget:
//   1. Fetch active memories for user — direct read, no embedding.
//   2. Embed query (text-embedding-3-small). Graceful failure: facts block
//      still renders even if embed errors.
//   3. Hybrid retrieval over conversation chunks: cosine top-30 + FTS top-30
//      via Reciprocal Rank Fusion (k=60, Cormack-Buettcher-Clarke 2009).
//   4. Hybrid retrieval over memory siblings: same RRF over kind='memory'
//      documents, returning {memory_id: rrf} for query-aware fact ranking.
//   5. Facts-first assembly: priority-pack under maxTokens. Conversation
//      block fills remaining budget.

const RRF_K = 60;
const CANDIDATE_LIMIT = 30;
const CHARS_PER_TOKEN = 4; // crude budget heuristic

export type RecallCitation = {
  kind: "turn_message" | "memory";
  content: string;
  score: number;
  turnId: string | null;
  createdAt: string | null;
};

export type RecallResult = {
  context: string;
  citations: RecallCitation[];
  embedError: string | null;
  factCount: number;
  convCount: number;
};

export type RecallInput = {
  userId: string;
  query: string;
  maxTokens?: number;
};

type HybridHit = {
  docId: string;
  memoryId: string | null;
  content: string;
  turnId: string | null;
  createdAt: Date | null;
  cosine: number;
  rrf: number;
};

function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

// Reciprocal Rank Fusion. Multiple rankings → one combined score.
// Each ranking contributes 1 / (k + rank), summed across rankings.
function fuseRanks(rankings: string[][]): Map<string, number> {
  const out = new Map<string, number>();
  for (const ranking of rankings) {
    for (let i = 0; i < ranking.length; i++) {
      const id = ranking[i];
      if (!id) continue;
      const inc = 1 / (RRF_K + (i + 1));
      out.set(id, (out.get(id) ?? 0) + inc);
    }
  }
  return out;
}

async function hybridRetrieve(
  userId: string,
  kind: "turn_message" | "memory",
  queryVec: number[] | null,
  query: string,
): Promise<HybridHit[]> {
  const vecLiteral = queryVec ? toPgVectorLiteral(queryVec) : null;

  // Cosine top-30 (only if we have a query vector).
  const cosineRows: Array<{
    id: string;
    memoryId: string | null;
    content: string;
    turnId: string | null;
    createdAt: Date | null;
    cosine: number;
  }> = vecLiteral
    ? await db
        .select({
          id: memDocuments.id,
          memoryId: memDocuments.memoryId,
          content: memDocuments.content,
          turnId: memDocuments.turnId,
          createdAt: memDocuments.createdAt,
          cosine: sql<number>`1 - (${memEmbeddings.embedding} <=> ${vecLiteral}::vector)`,
        })
        .from(memDocuments)
        .innerJoin(memEmbeddings, eq(memEmbeddings.documentId, memDocuments.id))
        .where(
          and(eq(memDocuments.userId, userId), eq(memDocuments.kind, kind)),
        )
        .orderBy(sql`${memEmbeddings.embedding} <=> ${vecLiteral}::vector`)
        .limit(CANDIDATE_LIMIT)
    : [];

  // FTS top-30.
  const ftsRows = await db
    .select({
      id: memDocuments.id,
      memoryId: memDocuments.memoryId,
      content: memDocuments.content,
      turnId: memDocuments.turnId,
      createdAt: memDocuments.createdAt,
      rank: sql<number>`ts_rank_cd(${memDocuments.tsv}, plainto_tsquery('simple', ${query}))`,
    })
    .from(memDocuments)
    .where(
      and(
        eq(memDocuments.userId, userId),
        eq(memDocuments.kind, kind),
        sql`${memDocuments.tsv} @@ plainto_tsquery('simple', ${query})`,
      ),
    )
    .orderBy(
      desc(
        sql`ts_rank_cd(${memDocuments.tsv}, plainto_tsquery('simple', ${query}))`,
      ),
    )
    .limit(CANDIDATE_LIMIT);

  const cosineIds = cosineRows.map((r) => r.id);
  const ftsIds = ftsRows.map((r) => r.id);
  const fused = fuseRanks([cosineIds, ftsIds]);

  // Build hit map from union of candidates.
  const byId = new Map<string, HybridHit>();
  for (const r of cosineRows) {
    byId.set(r.id, {
      docId: r.id,
      memoryId: r.memoryId,
      content: r.content,
      turnId: r.turnId,
      createdAt: r.createdAt,
      cosine: r.cosine,
      rrf: fused.get(r.id) ?? 0,
    });
  }
  for (const r of ftsRows) {
    if (byId.has(r.id)) continue;
    byId.set(r.id, {
      docId: r.id,
      memoryId: r.memoryId,
      content: r.content,
      turnId: r.turnId,
      createdAt: r.createdAt,
      cosine: 0,
      rrf: fused.get(r.id) ?? 0,
    });
  }

  return [...byId.values()].sort((a, b) => b.rrf - a.rrf);
}

function tokenBudget(s: string): number {
  return Math.ceil(s.length / CHARS_PER_TOKEN);
}

function formatTimestamp(d: Date | string | null): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export async function recall(input: RecallInput): Promise<RecallResult> {
  const { userId, query } = input;
  const maxTokens = input.maxTokens ?? 400;

  // Step 1 — fetch active memories.
  const activeMemories = await db
    .select({
      id: memMemories.id,
      type: memMemories.type,
      slot: memMemories.slot,
      value: memMemories.value,
      confidence: memMemories.confidence,
    })
    .from(memMemories)
    .where(and(eq(memMemories.userId, userId), eq(memMemories.active, true)));

  if (activeMemories.length === 0 && !query.trim()) {
    return {
      context: "",
      citations: [],
      embedError: null,
      factCount: 0,
      convCount: 0,
    };
  }

  // Step 2 — embed query (graceful failure).
  let queryVec: number[] | null = null;
  let embedError: string | null = null;
  if (query.trim()) {
    try {
      const result = await embed(query);
      queryVec = result.vectors[0] ?? null;
    } catch (err) {
      embedError = err instanceof Error ? err.message : "embed_query_failed";
    }
  }

  // Steps 3 + 4 — hybrid retrieval. Skip if no query at all.
  const convHits = query.trim()
    ? await hybridRetrieve(userId, "turn_message", queryVec, query)
    : [];
  const memHits = query.trim()
    ? await hybridRetrieve(userId, "memory", queryVec, query)
    : [];

  // Build memory rrf map for query-aware fact ranking.
  const memRrf = new Map<string, number>();
  for (const h of memHits) {
    if (h.memoryId) memRrf.set(h.memoryId, h.rrf);
  }

  // Sort active memories by query relevance (RRF) when query present;
  // otherwise stable by type then slot.
  type RankedMem = (typeof activeMemories)[number] & { rrf: number };
  const ranked: RankedMem[] = activeMemories
    .map((m) => ({ ...m, rrf: memRrf.get(m.id) ?? 0 }))
    .sort((a, b) => {
      if (a.rrf !== b.rrf) return b.rrf - a.rrf;
      return a.slot.localeCompare(b.slot);
    });

  // Step 5 — facts-first assembly under token budget.
  const lines: string[] = [];
  const citations: RecallCitation[] = [];
  let remaining = maxTokens;

  // Facts block.
  const factHeader = "## Known about this user";
  if (ranked.length > 0) {
    lines.push(factHeader);
    remaining -= tokenBudget(factHeader);
    for (const m of ranked) {
      const line = `- ${m.slot}: ${m.value}`;
      const cost = tokenBudget(line);
      if (cost > remaining) break;
      lines.push(line);
      remaining -= cost;
      citations.push({
        kind: "memory",
        content: `${m.slot}: ${m.value}`,
        score: m.rrf,
        turnId: null,
        createdAt: null,
      });
    }
  }
  const factCount = citations.length;

  // Conversation block.
  let convCount = 0;
  if (convHits.length > 0 && remaining > 20) {
    const convHeader = "\n## Relevant from recent activity";
    lines.push(convHeader);
    remaining -= tokenBudget(convHeader);
    for (const h of convHits) {
      const ts = formatTimestamp(h.createdAt);
      const snippet =
        h.content.length > 180 ? `${h.content.slice(0, 177)}…` : h.content;
      const line = `- [${ts}] ${snippet}`;
      const cost = tokenBudget(line);
      if (cost > remaining) break;
      lines.push(line);
      remaining -= cost;
      citations.push({
        kind: "turn_message",
        content: h.content,
        score: h.cosine,
        turnId: h.turnId,
        createdAt: ts,
      });
      convCount++;
    }
  }

  return {
    context: lines.join("\n"),
    citations,
    embedError,
    factCount,
    convCount,
  };
}

export type ListMemoriesResult = Array<{
  id: string;
  type: MemoryType;
  key: string;
  slot: string;
  value: string;
  confidence: string;
  active: boolean;
  supersedes: string | null;
  createdAt: Date;
  updatedAt: Date;
}>;

export async function listUserMemories(
  userId: string,
  opts?: { activeOnly?: boolean },
): Promise<ListMemoriesResult> {
  const activeOnly = opts?.activeOnly ?? false;
  const rows = await db
    .select({
      id: memMemories.id,
      type: memMemories.type,
      key: memMemories.key,
      slot: memMemories.slot,
      value: memMemories.value,
      confidence: memMemories.confidence,
      active: memMemories.active,
      supersedes: memMemories.supersedes,
      createdAt: memMemories.createdAt,
      updatedAt: memMemories.updatedAt,
    })
    .from(memMemories)
    .where(
      activeOnly
        ? and(eq(memMemories.userId, userId), eq(memMemories.active, true))
        : eq(memMemories.userId, userId),
    )
    .orderBy(asc(memMemories.slot), desc(memMemories.createdAt));

  return rows;
}

export async function listRecentTurns(
  userId: string,
  limit = 20,
): Promise<
  Array<{ id: string; sessionId: string; metadata: unknown; createdAt: Date }>
> {
  return db
    .select({
      id: memTurns.id,
      sessionId: memTurns.sessionId,
      metadata: memTurns.metadata,
      createdAt: memTurns.createdAt,
    })
    .from(memTurns)
    .where(eq(memTurns.userId, userId))
    .orderBy(desc(memTurns.createdAt))
    .limit(limit);
}

// Silence unused-import lint in environments without inArray usage.
export const _inArray = inArray;
