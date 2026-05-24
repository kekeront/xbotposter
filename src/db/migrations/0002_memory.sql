-- 0002_memory.sql — agentic memory layer
-- Mirrors §3-§7 of higgsfieldtz/memory-service architecture, ported to nfactz.
-- Hand-written: GENERATED tsvector column + partial unique index + HNSW are
-- not representable by drizzle-kit. Apply manually via Supabase SQL Editor.
--
-- Tables: mem_turns, mem_turn_messages, mem_memories, mem_documents, mem_embeddings.
-- All prefixed `mem_` to keep memory layer isolated from app tables.

CREATE TABLE "mem_turns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "session_id" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "mem_turns_user_session_idx" ON "mem_turns" ("user_id", "session_id");
CREATE INDEX "mem_turns_created_at_idx" ON "mem_turns" ("created_at" DESC);

CREATE TABLE "mem_turn_messages" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "turn_id" uuid NOT NULL REFERENCES "mem_turns"("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('user','assistant','system')),
  "idx" integer NOT NULL,
  "content" text NOT NULL
);

CREATE INDEX "mem_turn_messages_turn_idx" ON "mem_turn_messages" ("turn_id", "idx");

CREATE TABLE "mem_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "turn_id" uuid REFERENCES "mem_turns"("id") ON DELETE SET NULL,
  "type" text NOT NULL CHECK ("type" IN ('fact','preference','opinion','event')),
  "key" text NOT NULL,
  "slot" text NOT NULL,
  "value" text NOT NULL,
  "confidence" numeric(3,2) NOT NULL DEFAULT 0.85 CHECK ("confidence" >= 0 AND "confidence" <= 1),
  "active" boolean NOT NULL DEFAULT true,
  "supersedes" uuid REFERENCES "mem_memories"("id") ON DELETE SET NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "mem_memories_user_active_idx" ON "mem_memories" ("user_id", "active");
-- §4.1 supersession backstop: only one active row per (user, slot).
-- Application uses pg_advisory_xact_lock to serialise read-modify-write;
-- this index is the DB safety net.
CREATE UNIQUE INDEX "mem_memories_user_slot_active_uniq" ON "mem_memories" ("user_id", "slot") WHERE "active" = TRUE;

CREATE TABLE "mem_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" text NOT NULL,
  "kind" text NOT NULL CHECK ("kind" IN ('turn_message','memory')),
  "turn_id" uuid REFERENCES "mem_turns"("id") ON DELETE CASCADE,
  "memory_id" uuid REFERENCES "mem_memories"("id") ON DELETE CASCADE,
  "content" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  -- 'simple' dict: language-agnostic. We mix RU/EN/KZ; an English stemmer
  -- would mangle Russian tokens. Trades stemming for correctness.
  "tsv" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "mem_documents_user_kind_idx" ON "mem_documents" ("user_id", "kind");
CREATE INDEX "mem_documents_tsv_gin" ON "mem_documents" USING GIN ("tsv");
CREATE INDEX "mem_documents_memory_id_idx" ON "mem_documents" ("memory_id") WHERE "memory_id" IS NOT NULL;

CREATE TABLE "mem_embeddings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "document_id" uuid NOT NULL UNIQUE REFERENCES "mem_documents"("id") ON DELETE CASCADE,
  "embedding" vector(1536) NOT NULL
);

CREATE INDEX "mem_embeddings_hnsw" ON "mem_embeddings" USING hnsw ("embedding" vector_cosine_ops) WITH (m = 16, ef_construction = 64);
