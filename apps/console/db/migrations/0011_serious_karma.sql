CREATE TABLE "console_problems" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"hour" timestamp with time zone NOT NULL,
	"level" text NOT NULL,
	"message" text NOT NULL,
	"count" integer DEFAULT 1 NOT NULL,
	"fields" jsonb,
	"last_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "console_problems_hour_idx" ON "console_problems" USING btree ("hour","level","message");--> statement-breakpoint
CREATE INDEX "console_problems_last_idx" ON "console_problems" USING btree ("last_at");