CREATE TABLE "job_findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project" text NOT NULL,
	"job" text NOT NULL,
	"fingerprint" text NOT NULL,
	"linear_issue_id" text NOT NULL,
	"issue_identifier" text NOT NULL,
	"issue_url" text NOT NULL,
	"run_id" uuid,
	"filed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_slots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project" text NOT NULL,
	"job" text NOT NULL,
	"slot_at" timestamp with time zone NOT NULL,
	"run_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" ALTER COLUMN "work_item_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "project" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "job" text;--> statement-breakpoint
ALTER TABLE "job_findings" ADD CONSTRAINT "job_findings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_slots" ADD CONSTRAINT "job_slots_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "job_findings_fingerprint_idx" ON "job_findings" USING btree ("project","job","fingerprint","filed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "job_slots_slot_idx" ON "job_slots" USING btree ("project","job","slot_at");--> statement-breakpoint
CREATE INDEX "runs_job_idx" ON "runs" USING btree ("project","job","created_at") WHERE "runs"."job" is not null;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_work_item_or_job" CHECK (("runs"."work_item_id" is null) = ("runs"."job" is not null));--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_job_has_project" CHECK ("runs"."job" is null or "runs"."project" is not null);