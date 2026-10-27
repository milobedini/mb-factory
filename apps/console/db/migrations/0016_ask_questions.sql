CREATE TABLE "asks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project" text NOT NULL,
	"run_id" uuid,
	"asker_slack_id" text NOT NULL,
	"question" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"slack_ts" text,
	"answer_slack_ts" text,
	"ticket_filed_by" text,
	"ticket_filed_at" timestamp with time zone,
	"ticket_started" boolean,
	"ticket_issue_id" text,
	"ticket_identifier" text,
	"ticket_url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_work_item_or_job";--> statement-breakpoint
ALTER TABLE "runs" DROP CONSTRAINT "runs_job_has_project";--> statement-breakpoint
ALTER TABLE "asks" ADD CONSTRAINT "asks_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "asks_thread_idx" ON "asks" USING btree ("slack_channel_id","slack_ts");--> statement-breakpoint
CREATE INDEX "asks_run_idx" ON "asks" USING btree ("run_id");--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_work_item_job_or_question" CHECK (("runs"."work_item_id" is not null)::int + ("runs"."job" is not null)::int + ("runs"."agent" = 'ask')::int = 1);--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_without_work_item_have_project" CHECK ("runs"."work_item_id" is not null or "runs"."project" is not null);