CREATE TABLE "engine_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"embedding_mode" text DEFAULT 'deterministic' NOT NULL,
	"ollama_base_url" text DEFAULT 'http://127.0.0.1:11434' NOT NULL,
	"ollama_embedding_model" text DEFAULT 'bge-m3' NOT NULL,
	"ast_mode" text DEFAULT 'polyglot' NOT NULL,
	"workspace_kind" text DEFAULT 'worktree' NOT NULL,
	"skeleton_max_tokens" integer DEFAULT 2000 NOT NULL,
	"qmd_top_k" integer DEFAULT 5 NOT NULL,
	"auto_inject_in_runner" boolean DEFAULT true NOT NULL,
	"docker_cpu_limit" text DEFAULT '1.0' NOT NULL,
	"docker_memory_limit" text DEFAULT '512m' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "engine_configs_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
ALTER TABLE "engine_configs" ADD CONSTRAINT "engine_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;