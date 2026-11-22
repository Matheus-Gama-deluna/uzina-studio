CREATE TABLE "memory_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source_type" text NOT NULL,
	"memory_id" uuid,
	"source_path" text,
	"scope_type" text NOT NULL,
	"scope_id" uuid NOT NULL,
	"heading_path" text NOT NULL,
	"line_start" integer NOT NULL,
	"line_end" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"embedding" real[] NOT NULL,
	"embedding_model" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "memory_chunks" ADD CONSTRAINT "memory_chunks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memory_chunks" ADD CONSTRAINT "memory_chunks_memory_id_memories_id_fk" FOREIGN KEY ("memory_id") REFERENCES "public"."memories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_memory_chunks_org_scope" ON "memory_chunks" USING btree ("organization_id","scope_type","scope_id");--> statement-breakpoint
CREATE INDEX "idx_memory_chunks_memory_id" ON "memory_chunks" USING btree ("memory_id");--> statement-breakpoint
CREATE INDEX "idx_memory_chunks_source_path" ON "memory_chunks" USING btree ("organization_id","source_path");