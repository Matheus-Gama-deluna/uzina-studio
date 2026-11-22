CREATE TABLE "design_prototypes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"level" integer NOT NULL,
	"source" text NOT NULL,
	"title" text NOT NULL,
	"html_storage_path" text NOT NULL,
	"tokens_json" jsonb NOT NULL,
	"wireframe_mermaid" text,
	"approved" boolean DEFAULT false NOT NULL,
	"handoff_path" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_prototypes" ADD CONSTRAINT "design_prototypes_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_prototypes" ADD CONSTRAINT "design_prototypes_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "design_prototypes_project_idx" ON "design_prototypes" USING btree ("project_id");