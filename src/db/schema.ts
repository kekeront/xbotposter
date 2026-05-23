import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

export const GENERATION_STATUS = [
  "queued",
  "running",
  "succeeded",
  "failed",
] as const;
export type GenerationStatus = (typeof GENERATION_STATUS)[number];

export const POST_STATUS = [
  "draft",
  "approved",
  "scheduled",
  "posted",
  "failed",
  "skipped",
] as const;
export type PostStatus = (typeof POST_STATUS)[number];

export const CONTENT_TYPE = ["single", "thread", "qrt", "essay"] as const;
export type ContentType = (typeof CONTENT_TYPE)[number];

export const SOURCE_TYPE = [
  "hn",
  "arxiv",
  "substack",
  "x",
  "web",
  "manual",
] as const;
export type SourceType = (typeof SOURCE_TYPE)[number];

export const generations = pgTable("generations", {
  id: uuid("id").primaryKey().defaultRandom(),
  topic: text("topic").notNull(),
  inputMeta: jsonb("input_meta").$type<Record<string, unknown>>(),
  model: text("model"),
  status: text("status", { enum: GENERATION_STATUS })
    .$type<GenerationStatus>()
    .default("queued")
    .notNull(),
  tokensIn: integer("tokens_in").default(0).notNull(),
  tokensOut: integer("tokens_out").default(0).notNull(),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 })
    .default("0")
    .notNull(),
  error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
});

export const posts = pgTable(
  "posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationId: uuid("generation_id").references(() => generations.id, {
      onDelete: "set null",
    }),
    parentPostId: uuid("parent_post_id").references(
      (): AnyPgColumn => posts.id,
      { onDelete: "cascade" },
    ),
    threadPosition: integer("thread_position"),
    contentType: text("content_type", { enum: CONTENT_TYPE })
      .$type<ContentType>()
      .default("single")
      .notNull(),
    text: text("text").notNull(),
    status: text("status", { enum: POST_STATUS })
      .$type<PostStatus>()
      .default("draft")
      .notNull(),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }),
    postedAt: timestamp("posted_at", { withTimezone: true }),
    xTweetId: text("x_tweet_id"),
    quoteTweetId: text("quote_tweet_id"),
    embedding: vector("embedding", { dimensions: 1536 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("posts_status_idx").on(table.status),
    index("posts_scheduled_for_idx").on(table.scheduledFor),
    index("posts_embedding_hnsw").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const sources = pgTable(
  "sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type", { enum: SOURCE_TYPE }).$type<SourceType>().notNull(),
    externalId: text("external_id"),
    url: text("url"),
    title: text("title"),
    content: text("content"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    embedding: vector("embedding", { dimensions: 1536 }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("sources_type_external_id_uniq").on(
      table.type,
      table.externalId,
    ),
    index("sources_embedding_hnsw").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const viralPosts = pgTable(
  "viral_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    xUrl: text("x_url"),
    xTweetId: text("x_tweet_id"),
    author: text("author"),
    text: text("text").notNull(),
    engagement: jsonb("engagement").$type<{
      likes?: number;
      replies?: number;
      retweets?: number;
      bookmarks?: number;
      views?: number;
    }>(),
    embedding: vector("embedding", { dimensions: 1536 }),
    capturedAt: timestamp("captured_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("viral_posts_tweet_id_uniq").on(table.xTweetId),
    index("viral_posts_embedding_hnsw").using(
      "hnsw",
      table.embedding.op("vector_cosine_ops"),
    ),
  ],
);

export const claims = pgTable("claims", {
  id: uuid("id").primaryKey().defaultRandom(),
  postId: uuid("post_id")
    .references(() => posts.id, { onDelete: "cascade" })
    .notNull(),
  claimText: text("claim_text").notNull(),
  sourceId: uuid("source_id").references(() => sources.id, {
    onDelete: "set null",
  }),
  verified: boolean("verified").default(false).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const fingerprints = pgTable("fingerprints", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").default("default").notNull(),
  profile: jsonb("profile").$type<Record<string, unknown>>().notNull(),
  sampleCount: integer("sample_count").default(0).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const traces = pgTable(
  "traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    generationId: uuid("generation_id").references(() => generations.id, {
      onDelete: "cascade",
    }),
    agent: text("agent").notNull(),
    eventType: text("event_type").notNull(),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    model: text("model"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
    ts: timestamp("ts", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("traces_generation_id_idx").on(table.generationId),
    index("traces_ts_idx").on(table.ts),
  ],
);

export type Generation = typeof generations.$inferSelect;
export type NewGeneration = typeof generations.$inferInsert;
export type Post = typeof posts.$inferSelect;
export type NewPost = typeof posts.$inferInsert;
export type Source = typeof sources.$inferSelect;
export type NewSource = typeof sources.$inferInsert;
export type ViralPost = typeof viralPosts.$inferSelect;
export type NewViralPost = typeof viralPosts.$inferInsert;
export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;
export type Fingerprint = typeof fingerprints.$inferSelect;
export type NewFingerprint = typeof fingerprints.$inferInsert;
export type Trace = typeof traces.$inferSelect;
export type NewTrace = typeof traces.$inferInsert;

// Memory layer — typed assertions the system accumulates about the writer
// (voice/preference/opinion) and the world (event signals). Hybrid retrieval
// (pgvector + tsvector) wires these into the writer/take prompt context.
// Schema is applied by migrations/0002_memories.sql — Drizzle is the type
// source only (partial indexes, GENERATED tsvector, CHECK constraints are
// not expressible here and live in the raw SQL).
export const MEMORY_TYPE = ["fact", "preference", "opinion", "event"] as const;
export type MemoryType = (typeof MEMORY_TYPE)[number];

export const MEMORY_SOURCE_KIND = [
  "post",
  "telegram_seed",
  "generation_feedback",
  "manual",
  "viral_observation",
] as const;
export type MemorySourceKind = (typeof MEMORY_SOURCE_KIND)[number];

export const memories = pgTable(
  "memories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    type: text("type", { enum: MEMORY_TYPE }).$type<MemoryType>().notNull(),
    slot: text("slot").notNull(),
    content: text("content").notNull(),
    confidence: smallint("confidence").default(70).notNull(),
    sourceKind: text("source_kind", { enum: MEMORY_SOURCE_KIND }).$type<
      MemorySourceKind | null
    >(),
    sourceId: uuid("source_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown> | null>(),
    embedding: vector("embedding", { dimensions: 1536 }),
    supersededBy: uuid("superseded_by").references(
      (): AnyPgColumn => memories.id,
      { onDelete: "set null" },
    ),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    index("memories_active_type_idx").on(table.type, table.createdAt),
  ],
);

export type Memory = typeof memories.$inferSelect;
export type NewMemory = typeof memories.$inferInsert;

// Marker for raw SQL embedding distance helpers (used in future RAG queries).
export const VECTOR_COSINE_OPS = sql`vector_cosine_ops`;
