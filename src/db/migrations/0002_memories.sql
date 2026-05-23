CREATE TABLE "memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"type" text NOT NULL,
	"slot" text NOT NULL,
	"content" text NOT NULL,
	"confidence" smallint DEFAULT 70 NOT NULL,
	"source_kind" text,
	"source_id" uuid,
	"metadata" jsonb,
	"embedding" vector(1536),
	"text_search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', "content")) STORED,
	"superseded_by" uuid REFERENCES "memories"("id") ON DELETE SET NULL,
	"superseded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memories_type_check" CHECK ("type" IN ('fact', 'preference', 'opinion', 'event')),
	CONSTRAINT "memories_source_kind_check" CHECK ("source_kind" IS NULL OR "source_kind" IN ('post', 'telegram_seed', 'generation_feedback', 'manual', 'viral_observation')),
	CONSTRAINT "memories_confidence_range" CHECK ("confidence" BETWEEN 0 AND 100)
);
--> statement-breakpoint
CREATE INDEX "memories_active_slot_idx" ON "memories" ("slot") WHERE "superseded_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "memories_active_type_idx" ON "memories" ("type", "created_at" DESC) WHERE "superseded_at" IS NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX "memories_active_slot_uniq" ON "memories" ("slot", "type") WHERE "superseded_at" IS NULL AND "type" IN ('fact', 'preference');
--> statement-breakpoint
CREATE INDEX "memories_embedding_hnsw" ON "memories" USING hnsw ("embedding" vector_cosine_ops) WHERE "superseded_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "memories_text_search_gin" ON "memories" USING gin ("text_search") WHERE "superseded_at" IS NULL;
--> statement-breakpoint
CREATE INDEX "memories_source_idx" ON "memories" ("source_kind", "source_id") WHERE "source_id" IS NOT NULL;
