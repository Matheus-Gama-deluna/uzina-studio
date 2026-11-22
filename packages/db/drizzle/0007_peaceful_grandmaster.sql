CREATE TABLE "codebase_edges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"from_symbol_id" uuid NOT NULL,
	"to_symbol_id" uuid NOT NULL,
	"relation" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codebase_files" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository_id" uuid NOT NULL,
	"path" text NOT NULL,
	"sha256" text NOT NULL,
	"language" text NOT NULL,
	"size" integer NOT NULL,
	"indexed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "codebase_symbols" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"file_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"signature" text NOT NULL,
	"line_start" integer NOT NULL,
	"line_end" integer NOT NULL,
	"exported" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "decision_provenance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"decision_id" uuid,
	"memory_id" uuid,
	"symbol_id" uuid,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "codebase_edges" ADD CONSTRAINT "codebase_edges_from_symbol_id_codebase_symbols_id_fk" FOREIGN KEY ("from_symbol_id") REFERENCES "public"."codebase_symbols"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_edges" ADD CONSTRAINT "codebase_edges_to_symbol_id_codebase_symbols_id_fk" FOREIGN KEY ("to_symbol_id") REFERENCES "public"."codebase_symbols"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_files" ADD CONSTRAINT "codebase_files_repository_id_project_repositories_id_fk" FOREIGN KEY ("repository_id") REFERENCES "public"."project_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "codebase_symbols" ADD CONSTRAINT "codebase_symbols_file_id_codebase_files_id_fk" FOREIGN KEY ("file_id") REFERENCES "public"."codebase_files"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_provenance" ADD CONSTRAINT "decision_provenance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_provenance" ADD CONSTRAINT "decision_provenance_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_provenance" ADD CONSTRAINT "decision_provenance_decision_id_decisions_id_fk" FOREIGN KEY ("decision_id") REFERENCES "public"."decisions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_provenance" ADD CONSTRAINT "decision_provenance_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decision_provenance" ADD CONSTRAINT "decision_provenance_symbol_id_codebase_symbols_id_fk" FOREIGN KEY ("symbol_id") REFERENCES "public"."codebase_symbols"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "codebase_edges_from_idx" ON "codebase_edges" USING btree ("from_symbol_id");--> statement-breakpoint
CREATE INDEX "codebase_edges_to_relation_idx" ON "codebase_edges" USING btree ("to_symbol_id","relation");--> statement-breakpoint
CREATE UNIQUE INDEX "codebase_files_repo_path_idx" ON "codebase_files" USING btree ("repository_id","path");--> statement-breakpoint
CREATE INDEX "codebase_symbols_file_idx" ON "codebase_symbols" USING btree ("file_id");--> statement-breakpoint
CREATE INDEX "codebase_symbols_name_idx" ON "codebase_symbols" USING btree ("name");--> statement-breakpoint
CREATE INDEX "decision_provenance_org_path_idx" ON "decision_provenance" USING btree ("organization_id","file_path");