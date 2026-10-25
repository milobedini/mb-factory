CREATE TABLE "questions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"prompt" text NOT NULL,
	"options" text[] NOT NULL,
	"answer" text,
	"answer_source" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"asked_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "questions" ADD CONSTRAINT "questions_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "questions_run_position_idx" ON "questions" USING btree ("run_id","position");--> statement-breakpoint
CREATE INDEX "questions_open_idx" ON "questions" USING btree ("run_id") WHERE "questions"."answered_at" is null and "questions"."closed_at" is null;