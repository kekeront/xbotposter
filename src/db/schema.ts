import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

// ─── Auth & Profiles ─────────────────────────────────────────────────────────

export type TrackedAccount = {
  username: string;
  name: string;
  topic?: string;
  id?: string;
};

export const profiles = pgTable("profiles", {
  id: uuid("id").primaryKey(), // matches supabase auth.users.id
  email: text("email"),
  displayName: text("display_name"),
  avatarUrl: text("avatar_url"),
  trackedAccounts: jsonb("tracked_accounts").$type<TrackedAccount[]>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .defaultNow()
    .notNull(),
});

export const SOCIAL_PROVIDER = ["x", "telegram"] as const;
export type SocialProvider = (typeof SOCIAL_PROVIDER)[number];

export const socialProviderEnum = pgEnum("social_provider", SOCIAL_PROVIDER);

export const socialConnections = pgTable(
  "social_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .references(() => profiles.id, { onDelete: "cascade" })
      .notNull(),
    provider: socialProviderEnum("provider").notNull(),
    providerUserId: text("provider_user_id").notNull(),
    providerUsername: text("provider_username"),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    tokenExpiresAt: timestamp("token_expires_at", { withTimezone: true }),
    scopes: text("scopes"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    connectedAt: timestamp("connected_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (table) => [
    uniqueIndex("social_connections_user_provider_uniq").on(
      table.userId,
      table.provider,
    ),
  ],
);

// ���── Content Engine ─────────────���────────────────────────────────────────────

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
  userId: uuid("user_id").references(() => profiles.id, {
    onDelete: "cascade",
  }),
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
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
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
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
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
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "cascade",
    }),
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
  userId: uuid("user_id").references(() => profiles.id, {
    onDelete: "cascade",
  }),
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
    userId: uuid("user_id").references(() => profiles.id, {
      onDelete: "set null",
    }),
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

export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;
export type SocialConnection = typeof socialConnections.$inferSelect;
export type NewSocialConnection = typeof socialConnections.$inferInsert;
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

// Marker for raw SQL embedding distance helpers (used in future RAG queries).
export const VECTOR_COSINE_OPS = sql`vector_cosine_ops`;
