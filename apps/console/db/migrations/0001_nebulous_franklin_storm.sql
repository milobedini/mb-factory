CREATE TABLE "queue" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"priority" text NOT NULL,
	"reason" text NOT NULL,
	"release_at" timestamp with time zone,
	"held_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"parent_run_id" uuid,
	"agent" text NOT NULL,
	"model" text NOT NULL,
	"trigger" text NOT NULL,
	"priority" text NOT NULL,
	"status" text NOT NULL,
	"outcome" text,
	"summary" text,
	"report" jsonb,
	"actions_run_id" text,
	"actions_run_url" text,
	"transcript_url" text,
	"input_tokens" integer,
	"output_tokens" integer,
	"cache_read_input_tokens" integer,
	"cache_creation_input_tokens" integer,
	"cost_usd" double precision,
	"duration_ms" integer,
	"num_turns" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"dispatched_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "usage_readings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"window" text NOT NULL,
	"utilisation" double precision NOT NULL,
	"resets_at" timestamp with time zone NOT NULL,
	"status" text,
	"source" text NOT NULL,
	"run_id" uuid,
	"taken_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project" text NOT NULL,
	"repository" text NOT NULL,
	"linear_issue_id" text NOT NULL,
	"issue_identifier" text NOT NULL,
	"issue_url" text NOT NULL,
	"linear_project_id" text,
	"agent_session_id" text,
	"origin" text NOT NULL,
	"slack_channel_id" text,
	"slack_thread_ts" text,
	"requester" text,
	"stage" text NOT NULL,
	"review_rounds" integer DEFAULT 0 NOT NULL,
	"branch" text,
	"pr_number" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "work_items_linearIssueId_unique" UNIQUE("linear_issue_id")
);
--> statement-breakpoint
ALTER TABLE "queue" ADD CONSTRAINT "queue_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_parent_run_id_runs_id_fk" FOREIGN KEY ("parent_run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_readings" ADD CONSTRAINT "usage_readings_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "queue_waiting_idx" ON "queue" USING btree ("held_at") WHERE "queue"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "queue_one_hold_per_run_idx" ON "queue" USING btree ("run_id") WHERE "queue"."released_at" is null;--> statement-breakpoint
CREATE INDEX "runs_work_item_idx" ON "runs" USING btree ("work_item_id","created_at");--> statement-breakpoint
CREATE INDEX "runs_active_idx" ON "runs" USING btree ("status") WHERE "runs"."status" in ('dispatched', 'running');--> statement-breakpoint
CREATE INDEX "usage_readings_window_taken_idx" ON "usage_readings" USING btree ("window","taken_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "work_items_agent_session_idx" ON "work_items" USING btree ("agent_session_id");