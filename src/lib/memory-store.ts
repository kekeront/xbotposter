import "server-only";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db/client";
import {
  type Memory,
  memories,
  type MemorySourceKind,
  type MemoryType,
  type NewMemory,
} from "@/db/schema";
import { embedOne, toPgVectorLiteral } from "./embeddings";

export type RecordMemoryInput = {
  type: MemoryType;
  slot: string;
  content: string;
  confidence?: number; // 0-100, default 70
  sourceKind?: MemorySourceKind | null;
  sourceId?: string | null;
  metadata?: Record<string, unknown> | null;
  // If true and type is fact/preference, any existing active memory in the
  // same slot is superseded in a single transaction (atomic switch).
  // Default true. For opinion/event the partial unique index does not apply,
  // so stacking is allowed and we never auto-supersede.
  superseding?: boolean;
};

export type RecordMemoryResult = {
  memory: Memory;
  superseded: Memory | null;
  costUsd: number;
};

const SUPERSEDING_TYPES: MemoryType[] = ["fact", "preference"];

// Idempotent record. For fact/preference, atomically supersedes any active
// row in the same slot. For opinion/event, just inserts.
//
// Embedding is computed inside the transaction so failures bubble up before
// we commit a vectorless row.
export async function recordMemory(
  input: RecordMemoryInput,
): Promise<RecordMemoryResult> {
  const wantsSupersede =
    (input.superseding ?? true) && SUPERSEDING_TYPES.includes(input.type);

  const embed = await embedOne(input.content);

  return await db.transaction(async (tx) => {
    if (wantsSupersede) {
      // Serialize concurrent writes to the same slot using an advisory lock.
      // hashtext is collision-prone in theory but fine for our cardinality.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${input.slot}))`);
    }

    let superseded: Memory | null = null;
    if (wantsSupersede) {
      const active = await tx
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.slot, input.slot),
            eq(memories.type, input.type),
            isNull(memories.supersededAt),
          ),
        )
        .limit(1);

      if (active.length > 0 && active[0]) {
        // Same content + confidence? No-op return the existing row.
        if (
          active[0].content === input.content &&
          active[0].confidence === (input.confidence ?? 70)
        ) {
          return { memory: active[0], superseded: null, costUsd: embed.costUsd };
        }
        superseded = active[0];
      }
    } else if (input.sourceId) {
      // opinion/event don't supersede, but we still dedupe by (sourceId, slot, type)
      // to avoid the LLM extractor inserting duplicates within a single batch or
      // across racing fire-and-forget callers (poster + telegram webhook).
      const dup = await tx
        .select()
        .from(memories)
        .where(
          and(
            eq(memories.type, input.type),
            eq(memories.slot, input.slot),
            eq(memories.sourceId, input.sourceId),
          ),
        )
        .limit(1);
      if (dup.length > 0 && dup[0]) {
        return { memory: dup[0], superseded: null, costUsd: embed.costUsd };
      }
    }

    const insertValues: NewMemory = {
      type: input.type,
      slot: input.slot,
      content: input.content,
      confidence: input.confidence ?? 70,
      sourceKind: input.sourceKind ?? null,
      sourceId: input.sourceId ?? null,
      metadata: input.metadata ?? null,
    };

    const [created] = await tx.insert(memories).values(insertValues).returning();
    if (!created) throw new Error("recordMemory: insert returned no row");

    // Set the pgvector column with raw SQL (Drizzle's vector column expects
    // number[] but postgres.js needs the array-literal string for HNSW).
    await tx.execute(
      sql`UPDATE memories SET embedding = ${toPgVectorLiteral(embed.vector)}::vector WHERE id = ${created.id}`,
    );

    if (superseded) {
      await tx
        .update(memories)
        .set({ supersededBy: created.id, supersededAt: new Date() })
        .where(eq(memories.id, superseded.id));
    }

    return { memory: created, superseded, costUsd: embed.costUsd };
  });
}

export async function getActiveBySlot(slot: string): Promise<Memory | null> {
  const rows = await db
    .select()
    .from(memories)
    .where(and(eq(memories.slot, slot), isNull(memories.supersededAt)))
    .orderBy(desc(memories.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export async function listActiveByType(
  type: MemoryType,
  limit = 50,
): Promise<Memory[]> {
  return await db
    .select()
    .from(memories)
    .where(and(eq(memories.type, type), isNull(memories.supersededAt)))
    .orderBy(desc(memories.createdAt))
    .limit(limit);
}

export async function supersedeManually(memoryId: string): Promise<void> {
  await db
    .update(memories)
    .set({ supersededBy: memoryId, supersededAt: new Date() })
    .where(eq(memories.id, memoryId));
}

export async function countActive(): Promise<Record<MemoryType, number>> {
  const rows = await db
    .select({
      type: memories.type,
      n: sql<number>`count(*)::int`,
    })
    .from(memories)
    .where(isNull(memories.supersededAt))
    .groupBy(memories.type);
  const out: Record<MemoryType, number> = {
    fact: 0,
    preference: 0,
    opinion: 0,
    event: 0,
  };
  for (const r of rows) out[r.type] = r.n;
  return out;
}
