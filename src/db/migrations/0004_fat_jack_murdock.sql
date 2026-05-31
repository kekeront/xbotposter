ALTER TABLE "profiles" ADD COLUMN "tracked_accounts" jsonb;--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "messages" jsonb;--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "output_text" text;