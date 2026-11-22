CREATE TABLE "token_savings_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"deliverable_id" uuid,
	"technique" text NOT NULL,
	"tokens_baseline" integer NOT NULL,
	"tokens_actual" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "token_savings_events" ADD CONSTRAINT "token_savings_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "token_savings_events" ADD CONSTRAINT "token_savings_events_deliverable_id_deliverables_id_fk" FOREIGN KEY ("deliverable_id") REFERENCES "public"."deliverables"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "token_savings_events_org_created_idx" ON "token_savings_events" USING btree ("organization_id","created_at");