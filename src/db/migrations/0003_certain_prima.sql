CREATE TYPE "public"."social_provider" AS ENUM('x', 'telegram');--> statement-breakpoint
CREATE TABLE "profiles" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text,
	"display_name" text,
	"avatar_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "social_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"provider" "social_provider" NOT NULL,
	"provider_user_id" text NOT NULL,
	"provider_username" text,
	"access_token" text,
	"refresh_token" text,
	"token_expires_at" timestamp with time zone,
	"scopes" text,
	"meta" jsonb,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "fingerprints" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "generations" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "posts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "sources" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "traces" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "viral_posts" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "social_connections" ADD CONSTRAINT "social_connections_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "social_connections_user_provider_uniq" ON "social_connections" USING btree ("user_id","provider");--> statement-breakpoint
ALTER TABLE "fingerprints" ADD CONSTRAINT "fingerprints_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generations" ADD CONSTRAINT "generations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sources" ADD CONSTRAINT "sources_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "traces" ADD CONSTRAINT "traces_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "viral_posts" ADD CONSTRAINT "viral_posts_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;