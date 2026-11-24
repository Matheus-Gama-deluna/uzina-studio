ALTER TABLE "projects" ADD COLUMN "budget_cap_tokens" integer;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "finalize_policy" text DEFAULT 'local_merge' NOT NULL;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD COLUMN "custom_pricing_json" jsonb DEFAULT '{}'::jsonb NOT NULL;