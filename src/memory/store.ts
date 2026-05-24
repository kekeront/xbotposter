import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db/client";
import { embed } from "@/lib/llm";
import { extractMemoriesFromTurn, type ExtractedMemory } from "./extract";
import {
  type MemoryRole,
  memDocuments,
  memEmbeddings,
  memMemories,
  memTurnMessages,
  memTurns,
} from "./schema";
import { canonicaliseSlot } from "./slots";

// §3 POST /turns equivalent. One agent turn → persisted as:
//   - mem_turns row + metadata (embed_error / extraction_error if applicable)
//   - mem_turn_messages: raw role/content rows
//   - mem_memories: extracted typed memories with canonical-slot supersession
//   - mem_documents (kind='turn_message'): one per message, searchable
//   - mem_documents (kind='memory'): one per kept memory, query-aware fact ranking
//   - mem_embeddings: vector per document, FK
//
// Graceful failure: extract or embed transient errors persist as flags on
// mem_turns.metadata. The turn always commits.

export type TurnMessage = {
  role: MemoryRole;
  content: string;
};

export type RecordTurnInput = {
  userId: string;
  sessionId: string;
  messages: TurnMessage[];
  metadata?: Record<string, unknown>;
};

export type RecordTurnResult = {
  turnId: string;
  memories: Array<{ id: string; slot: string; superseded: string | null }>;
  embedError: string | null;
  extractionError: string | null;
};

function toPgVectorLiteral(vec: number[]): string {
  return `[${vec.join(",")}]`;
}

function isSlotSuperseded(type: ExtractedMemory["type"]): boolean {
  // §4.1: fact + preference get canonical-slot supersession.
  // opinion + event are append-only (arcs / event log).
  return type === "fact" || type === "preference";
}

export async function recordTurn(
  input: RecordTurnInput,
): Promise<RecordTurnResult> {
  const { userId, sessionId, messages } = input;
  const initialMeta = input.metadata ?? {};

  // Phase 1 — OpenAI calls outside the transaction. Slow, fail-tolerant.
  const extract = await extractMemoriesFromTurn(messages);
  const extractionError = extract.error;

  // Texts we need vectors for: every turn message + every extracted memory value.
  const turnTexts = messages.map((m) => m.content);
  const memoryTexts = extract.memories.map((m) => `${m.key}: ${m.value}`);
  const allTexts = [...turnTexts, ...memoryTexts];

  let vectors: number[][] | null = null;
  let embedError: string | null = null;
  if (allTexts.length > 0) {
    try {
      const result = await embed(allTexts);
      if (result.vectors.length !== allTexts.length) {
        embedError = "vector_count_mismatch";
      } else {
        vectors = result.vectors;
      }
    } catch (err) {
      embedError = err instanceof Error ? err.message : "embed_failed";
    }
  }

  // Phase 2 — single transaction for all DB writes.
  return db.transaction(async (tx) => {
    const turnMetadata = {
      ...initialMeta,
      ...(embedError ? { embed_error: embedError } : {}),
      ...(extractionError ? { extraction_error: extractionError } : {}),
    };

    const [turnRow] = await tx
      .insert(memTurns)
      .values({ userId, sessionId, metadata: turnMetadata })
      .returning();

    if (!turnRow) throw new Error("mem_turns insert returned no row");
    const turnId = turnRow.id;

    // Insert turn messages.
    const insertedTurnMessages =
      messages.length > 0
        ? await tx
            .insert(memTurnMessages)
            .values(
              messages.map((m, idx) => ({
                turnId,
                role: m.role,
                idx,
                content: m.content,
              })),
            )
            .returning()
        : [];

    // Per-memory supersession with advisory lock per (user, slot).
    const keptMemories: Array<{
      id: string;
      slot: string;
      type: ExtractedMemory["type"];
      value: string;
      superseded: string | null;
    }> = [];

    for (const mem of extract.memories) {
      const slot = canonicaliseSlot(mem.key);
      const lockKey = `${userId}:${slot}`;

      // Serialise concurrent /turns to the same slot. xact_lock is auto-released
      // when the transaction commits or rolls back.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`,
      );

      if (isSlotSuperseded(mem.type)) {
        const existing = await tx
          .select()
          .from(memMemories)
          .where(
            and(
              eq(memMemories.userId, userId),
              eq(memMemories.slot, slot),
              eq(memMemories.active, true),
            ),
          )
          .limit(1);

        const prior = existing[0];
        if (prior) {
          if (prior.value === mem.value) {
            // Idempotent: re-statement bumps updated_at, no new row.
            await tx
              .update(memMemories)
              .set({ updatedAt: new Date() })
              .where(eq(memMemories.id, prior.id));
            keptMemories.push({
              id: prior.id,
              slot,
              type: mem.type,
              value: mem.value,
              superseded: null,
            });
            continue;
          }

          // Different value: retire prior, insert new with supersedes link.
          await tx
            .update(memMemories)
            .set({ active: false, updatedAt: new Date() })
            .where(eq(memMemories.id, prior.id));

          // Drop the prior row's kind='memory' document so /recall does not
          // surface a stale fact via hybrid retrieval.
          await tx
            .delete(memDocuments)
            .where(
              and(
                eq(memDocuments.kind, "memory"),
                eq(memDocuments.memoryId, prior.id),
              ),
            );

          const [inserted] = await tx
            .insert(memMemories)
            .values({
              userId,
              turnId,
              type: mem.type,
              key: mem.key,
              slot,
              value: mem.value,
              confidence: mem.confidence.toFixed(2),
              active: true,
              supersedes: prior.id,
            })
            .returning();

          if (inserted) {
            keptMemories.push({
              id: inserted.id,
              slot,
              type: mem.type,
              value: mem.value,
              superseded: prior.id,
            });
          }
          continue;
        }
      }

      // Fresh slot OR append-only type (opinion/event): plain insert.
      const [inserted] = await tx
        .insert(memMemories)
        .values({
          userId,
          turnId,
          type: mem.type,
          key: mem.key,
          slot,
          value: mem.value,
          confidence: mem.confidence.toFixed(2),
          active: true,
        })
        .returning();

      if (inserted) {
        keptMemories.push({
          id: inserted.id,
          slot,
          type: mem.type,
          value: mem.value,
          superseded: null,
        });
      }
    }

    // mem_documents — one per turn message + one per kept memory.
    type DocInsert = {
      userId: string;
      kind: "turn_message" | "memory";
      turnId: string;
      memoryId: string | null;
      content: string;
      metadata: Record<string, unknown>;
    };

    const docInserts: DocInsert[] = [];
    for (let i = 0; i < insertedTurnMessages.length; i++) {
      const row = insertedTurnMessages[i];
      if (!row) continue;
      docInserts.push({
        userId,
        kind: "turn_message",
        turnId,
        memoryId: null,
        content: row.content,
        metadata: { role: row.role, idx: row.idx },
      });
    }
    for (const km of keptMemories) {
      docInserts.push({
        userId,
        kind: "memory",
        turnId,
        memoryId: km.id,
        content: `${km.slot}: ${km.value}`,
        metadata: { type: km.type, slot: km.slot },
      });
    }

    const insertedDocs =
      docInserts.length > 0
        ? await tx
            .insert(memDocuments)
            .values(
              docInserts.map((d) => ({
                userId: d.userId,
                kind: d.kind,
                turnId: d.turnId,
                memoryId: d.memoryId,
                content: d.content,
                metadata: d.metadata,
              })),
            )
            .returning()
        : [];

    // mem_embeddings — only if we have vectors. Align by content-order:
    // first N vectors = turn messages, next M = kept memories.
    if (vectors) {
      const turnMsgDocs = insertedDocs.filter((d) => d.kind === "turn_message");
      const memoryDocs = insertedDocs.filter((d) => d.kind === "memory");

      const embeddingInserts: { documentId: string; embedding: string }[] = [];
      for (let i = 0; i < turnMsgDocs.length && i < turnTexts.length; i++) {
        const doc = turnMsgDocs[i];
        const v = vectors[i];
        if (doc && v) {
          embeddingInserts.push({
            documentId: doc.id,
            embedding: toPgVectorLiteral(v),
          });
        }
      }
      // Memory vectors live at offset turnTexts.length in `vectors` —
      // but `keptMemories` may include some idempotent (no-change) entries
      // that didn't get a new doc, which would misalign. Re-align by
      // matching memory doc's memoryId to the extract.memories order.
      for (let docIdx = 0; docIdx < memoryDocs.length; docIdx++) {
        const doc = memoryDocs[docIdx];
        if (!doc?.memoryId) continue;
        const keptIdx = keptMemories.findIndex((k) => k.id === doc.memoryId);
        if (keptIdx === -1) continue;
        // Map keptIdx back to extract.memories index — same order since
        // we iterated extract.memories sequentially building keptMemories.
        const vec = vectors[turnTexts.length + keptIdx];
        if (vec) {
          embeddingInserts.push({
            documentId: doc.id,
            embedding: toPgVectorLiteral(vec),
          });
        }
      }

      if (embeddingInserts.length > 0) {
        await tx.insert(memEmbeddings).values(
          embeddingInserts.map((e) => ({
            documentId: e.documentId,
            embedding: e.embedding as unknown as number[],
          })),
        );
      }
    }

    return {
      turnId,
      memories: keptMemories.map((k) => ({
        id: k.id,
        slot: k.slot,
        superseded: k.superseded,
      })),
      embedError,
      extractionError,
    };
  });
}
