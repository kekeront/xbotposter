import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { memories as memoriesTable, type Memory, type MemoryType } from "@/db/schema";
import { embedOne, toPgVectorLiteral } from "./embeddings";

export type RecallInput = {
  query: string;
  // Maximum approximate characters of memory text to include. Default 1800
  // (~450 tokens), tuned for our writer prompts.
  maxChars?: number;
  // Per-channel candidate cap before fusion. Higher = more recall, more cost.
  candidatesPerChannel?: number;
  // RRF constant. 60 is the literature default.
  rrfK?: number;
};

export type RecallResult = {
  memories: ScoredMemory[];
  promptBlock: string; // ready to drop into a writer system message
  cost: { embed: number };
  diagnostics: {
    vectorHits: number;
    ftsHits: number;
    fused: number;
    truncated: number;
    queryEmpty: boolean;
  };
};

export type ScoredMemory = Memory & { score: number };

// Reciprocal rank fusion of pgvector cosine + Postgres FTS ts_rank_cd.
// Returns memories ranked by fused score, then priority-assembled into a
// compact prompt block under the token budget.
export async function recallMemories(input: RecallInput): Promise<RecallResult> {
  const query = input.query.trim();
  const maxChars = input.maxChars ?? 1800;
  const candidates = input.candidatesPerChannel ?? 30;
  const rrfK = input.rrfK ?? 60;

  // Always include the most recent active facts as a stable baseline — they
  // describe who the writer is, not what's relevant to this query, and the
  // priority assembly will demote them only if we run out of budget.
  const facts = await db.execute<Memory>(sql`
    SELECT id, type, slot, content, confidence, source_kind AS "sourceKind",
           source_id AS "sourceId", metadata, embedding,
           superseded_by AS "supersededBy", superseded_at AS "supersededAt",
           created_at AS "createdAt"
    FROM memories
    WHERE superseded_at IS NULL AND type = 'fact'
    ORDER BY confidence DESC, created_at DESC
    LIMIT 10
  `);

  if (!query) {
    // No query — return just stable facts as the prompt block.
    return assembleResult({
      stableFacts: rowsToMemories(facts),
      ranked: [],
      maxChars,
      embedCost: 0,
      diagnostics: {
        vectorHits: 0,
        ftsHits: 0,
        fused: 0,
        truncated: 0,
        queryEmpty: true,
      },
    });
  }

  const embed = await embedOne(query);

  // Vector recall: top-N by cosine distance over active memories.
  const vectorRows = await db.execute<{ id: string; rank: number }>(sql`
    SELECT id, ROW_NUMBER() OVER (ORDER BY embedding <=> ${toPgVectorLiteral(embed.vector)}::vector) AS rank
    FROM memories
    WHERE superseded_at IS NULL AND embedding IS NOT NULL
    ORDER BY embedding <=> ${toPgVectorLiteral(embed.vector)}::vector
    LIMIT ${candidates}
  `);

  // FTS recall: top-N by ts_rank_cd. plainto_tsquery is forgiving of
  // punctuation and stop-words — ideal for free-form queries.
  const ftsRows = await db.execute<{ id: string; rank: number }>(sql`
    SELECT id, ROW_NUMBER() OVER (ORDER BY ts_rank_cd(text_search, plainto_tsquery('simple', ${query})) DESC) AS rank
    FROM memories
    WHERE superseded_at IS NULL
      AND text_search @@ plainto_tsquery('simple', ${query})
    LIMIT ${candidates}
  `);

  // RRF fusion: score(id) = sum over channels of 1 / (k + rank_in_channel).
  const fused = new Map<string, number>();
  const addChannel = (rows: { id: string; rank: number }[]) => {
    for (const row of rows) {
      const r = Number(row.rank);
      if (!Number.isFinite(r) || r < 1) continue;
      fused.set(row.id, (fused.get(row.id) ?? 0) + 1 / (rrfK + r));
    }
  };
  addChannel(vectorRows as unknown as { id: string; rank: number }[]);
  addChannel(ftsRows as unknown as { id: string; rank: number }[]);

  if (fused.size === 0) {
    return assembleResult({
      stableFacts: rowsToMemories(facts),
      ranked: [],
      maxChars,
      embedCost: embed.costUsd,
      diagnostics: {
        vectorHits: vectorRows.length,
        ftsHits: ftsRows.length,
        fused: 0,
        truncated: 0,
        queryEmpty: false,
      },
    });
  }

  const ids = Array.from(fused.keys());
  const hydrated = await db
    .select()
    .from(memoriesTable)
    .where(inArray(memoriesTable.id, ids));

  const byId = new Map<string, Memory>();
  for (const m of hydrated) byId.set(m.id, m);

  const ranked: ScoredMemory[] = ids
    .map((id) => {
      const m = byId.get(id);
      const score = fused.get(id) ?? 0;
      return m ? { ...m, score } : null;
    })
    .filter((x): x is ScoredMemory => x !== null)
    .sort((a, b) => b.score - a.score);

  return assembleResult({
    stableFacts: rowsToMemories(facts),
    ranked,
    maxChars,
    embedCost: embed.costUsd,
    diagnostics: {
      vectorHits: vectorRows.length,
      ftsHits: ftsRows.length,
      fused: fused.size,
      truncated: 0,
      queryEmpty: false,
    },
  });
}

function rowsToMemories(rows: unknown): Memory[] {
  return rows as unknown as Memory[];
}

// Priority assembly under char budget. Order:
//   1. Stable facts (sorted by confidence/recency) — never demoted
//   2. Top fused matches (already sorted by RRF score)
// Dedupes facts already included in ranked. Cuts when adding next item
// would exceed maxChars.
function assembleResult(opts: {
  stableFacts: Memory[];
  ranked: ScoredMemory[];
  maxChars: number;
  embedCost: number;
  diagnostics: RecallResult["diagnostics"];
}): RecallResult {
  const seen = new Set<string>();
  const out: ScoredMemory[] = [];
  let chars = 0;
  let truncated = 0;

  const tryAdd = (m: Memory, score: number) => {
    if (seen.has(m.id)) return;
    const line = formatLine(m);
    if (chars + line.length + 1 > opts.maxChars) {
      truncated++;
      return;
    }
    seen.add(m.id);
    out.push({ ...m, score });
    chars += line.length + 1;
  };

  for (const f of opts.stableFacts) tryAdd(f, 1);
  for (const r of opts.ranked) tryAdd(r, r.score);

  return {
    memories: out,
    promptBlock: out.length === 0 ? "" : renderPromptBlock(out),
    cost: { embed: opts.embedCost },
    diagnostics: { ...opts.diagnostics, truncated },
  };
}

const TYPE_LABEL: Record<MemoryType, string> = {
  fact: "fact",
  preference: "pref",
  opinion: "view",
  event: "signal",
};

function formatLine(m: Memory): string {
  return `- (${TYPE_LABEL[m.type]}/${m.slot}, c=${m.confidence}) ${m.content}`;
}

function renderPromptBlock(memories: ScoredMemory[]): string {
  const lines = memories.map(formatLine);
  return `WHAT WE'VE LEARNED ABOUT THIS WRITER (memory layer)
Use these as background context. They are observations from past posts and
user feedback — NOT a script. Don't repeat them verbatim; let them shape
voice, stance, and topical priors.

${lines.join("\n")}`;
}
