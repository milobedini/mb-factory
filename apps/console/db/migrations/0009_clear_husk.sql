ALTER TABLE "questions" ADD COLUMN "why" text;--> statement-breakpoint
ALTER TABLE "questions" ADD COLUMN "slack_ts" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "spec_gate_slack_ts" text;