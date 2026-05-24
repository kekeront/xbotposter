import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const MEMORY_TYPE = ["fact", "preference", "opinion", "event"] as const;
export type MemoryType = (typeof MEMORY_TYPE)[number];

export const MEMORY_DOC_KIND = ["turn_message", "memory"] as const;
export type MemoryDocKind = (typeof MEMORY_DOC_KIND)[number];

export const MEMORY_ROLE = ["user", "assistant", "system"] as const;
export type MemoryRole = (typeof MEMORY_ROLE)[number];

// tsvector column type — read-only from Drizzle's POV. Postgres maintains it
// via GENERATED ALWAYS AS (to_tsvector('simple', content)) STORED in migration.
const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

export const memTurns = pgTable(
  "mem_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mem_turns_user_session_idx").on(t.userId, t.sessionId),
    index("mem_turns_created_at_idx").on(t.createdAt),
  ],
);

export const memTurnMessages = pgTable(
  "mem_turn_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    turnId: uuid("turn_id")
      .notNull()
      .references(() => memTurns.id, { onDelete: "cascade" }),
    role: text("role").$type<MemoryRole>().notNull(),
    idx: integer("idx").notNull(),
    content: text("content").notNull(),
  },
  (t) => [index("mem_turn_messages_turn_idx").on(t.turnId, t.idx)],
);

export const memMemories = pgTable(
  "mem_memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    turnId: uuid("turn_id").references(() => memTurns.id, {
      onDelete: "set null",
    }),
    type: text("type").$type<MemoryType>().notNull(),
    key: text("key").notNull(),
    slot: text("slot").notNull(),
    value: text("value").notNull(),
    confidence: numeric("confidence", { precision: 3, scale: 2 })
      .notNull()
      .default("0.85"),
    active: boolean("active").notNull().default(true),
    supersedes: uuid("supersedes").references(
      (): AnyPgColumn => memMemories.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mem_memories_user_active_idx").on(t.userId, t.active),
    // §4.1 backstop: one active row per (user, slot). Application uses
    // pg_advisory_xact_lock to serialise read-modify-write; this partial
    // unique index catches any logic bug as a hard DB constraint.
    uniqueIndex("mem_memories_user_slot_active_uniq")
      .on(t.userId, t.slot)
      .where(sql`${t.active} = true`),
  ],
);

export const memDocuments = pgTable(
  "mem_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    kind: text("kind").$type<MemoryDocKind>().notNull(),
    turnId: uuid("turn_id").references(() => memTurns.id, {
      onDelete: "cascade",
    }),
    memoryId: uuid("memory_id").references(() => memMemories.id, {
      onDelete: "cascade",
    }),
    content: text("content").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    tsv: tsvector("tsv"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("mem_documents_user_kind_idx").on(t.userId, t.kind),
    // GIN on tsv + partial index on memory_id are created in migration SQL;
    // not representable in Drizzle but tracked for awareness.
  ],
);

export const memEmbeddings = pgTable("mem_embeddings", {
  id: uuid("id").primaryKey().defaultRandom(),
  documentId: uuid("document_id")
    .notNull()
    .unique()
    .references(() => memDocuments.id, { onDelete: "cascade" }),
  embedding: vector("embedding", { dimensions: 1536 }).notNull(),
});

// Re-export check builder to silence unused import warnings if needed later.
export const _check = check;

export type MemTurn = typeof memTurns.$inferSelect;
export type NewMemTurn = typeof memTurns.$inferInsert;
export type MemMemory = typeof memMemories.$inferSelect;
export type NewMemMemory = typeof memMemories.$inferInsert;
export type MemDocument = typeof memDocuments.$inferSelect;
export type NewMemDocument = typeof memDocuments.$inferInsert;
export type MemEmbedding = typeof memEmbeddings.$inferSelect;
export type NewMemEmbedding = typeof memEmbeddings.$inferInsert;
