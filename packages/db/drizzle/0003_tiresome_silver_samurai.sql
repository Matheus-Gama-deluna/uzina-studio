CREATE TABLE "design_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"asset_type" text NOT NULL,
	"title" text NOT NULL,
	"source_url" text,
	"storage_path" text,
	"mime_type" text,
	"size_bytes" integer,
	"intention_tags" text[] DEFAULT '{}' NOT NULL,
	"notes" text,
	"approved" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "design_assets" ADD CONSTRAINT "design_assets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "design_assets" ADD CONSTRAINT "design_assets_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_design_assets_project_id" ON "design_assets" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_design_assets_deliverable_id" ON "design_assets" USING btree ("deliverable_id");