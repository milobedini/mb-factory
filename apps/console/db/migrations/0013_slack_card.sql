ALTER TABLE "work_items" ADD COLUMN "project_name" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "project_url" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "milestone_name" text;--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "next_ready" jsonb;