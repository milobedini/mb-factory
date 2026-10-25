CREATE TABLE "pauses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"paused_by" text NOT NULL,
	"paused_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resumed_by" text,
	"resumed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "usage_override_by" text;--> statement-breakpoint
CREATE UNIQUE INDEX "pauses_one_open_idx" ON "pauses" USING btree ((true)) WHERE "pauses"."resumed_at" is null;