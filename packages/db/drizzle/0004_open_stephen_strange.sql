CREATE TABLE "decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"mastra_step_id" text NOT NULL,
	"decision_type" text NOT NULL,
	"summary" text NOT NULL,
	"payload_json" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"human_feedback" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "execution_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"deliverable_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"actor_role" text NOT NULL,
	"event_type" text NOT NULL,
	"tokens_input" integer DEFAULT 0 NOT NULL,
	"tokens_output" integer DEFAULT 0 NOT NULL,
	"cache_read_tokens" integer DEFAULT 0 NOT NULL,
	"estimated_cost_usd" numeric(12, 6) DEFAULT '0' NOT NULL,
	"payload_json" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scan_id" uuid NOT NULL,
	"project_id" uuid,
	"rule_id" text NOT NULL,
	"scanner" text NOT NULL,
	"severity" text NOT NULL,
	"file_path" text,
	"line_start" integer,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"fingerprint" text NOT NULL,
	"triage_verdict" text DEFAULT 'pending' NOT NULL,
	"triage_rationale" text,
	"suppressed_in_memory" boolean DEFAULT false NOT NULL,
	"pov_test_status" text DEFAULT 'not_applicable' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "security_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"project_id" uuid,
	"deliverable_id" uuid,
	"mode" text NOT NULL,
	"target_type" text NOT NULL,
	"target_ref" text NOT NULL,
	"scanners_run" text[] NOT NULL,
	"scanner_statuses_json" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sarif_raw_json" jsonb NOT NULL,
	"summary_counts_json" jsonb NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions" ADD CONSTRAINT "decisions_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "execution_events" ADD CONSTRAINT "execution_events_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_scan_id_security_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."security_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scans" ADD CONSTRAINT "security_scans_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scans" ADD CONSTRAINT "security_scans_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "security_scans" ADD CONSTRAINT "security_scans_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_decisions_deliverable_status" ON "decisions" USING btree ("deliverable_id","status");--> statement-breakpoint
CREATE INDEX "idx_decisions_status_created" ON "decisions" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_execution_events_deliverable_created" ON "execution_events" USING btree ("deliverable_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_security_findings_scan_severity" ON "security_findings" USING btree ("scan_id","severity");--> statement-breakpoint
CREATE INDEX "idx_security_findings_project_fingerprint" ON "security_findings" USING btree ("project_id","fingerprint");--> statement-breakpoint
CREATE INDEX "idx_security_scans_org_created" ON "security_scans" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_security_scans_deliverable" ON "security_scans" USING btree ("deliverable_id");