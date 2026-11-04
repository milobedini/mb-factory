CREATE TABLE "pr_fixes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"repository" text NOT NULL,
	"pr_number" integer NOT NULL,
	"issue_identifier" text,
	"merged_at" timestamp with time zone NOT NULL,
	"by_pr_number" integer NOT NULL,
	"by_issue_identifier" text,
	"by_merged_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "pr_fixes_pair_idx" ON "pr_fixes" USING btree ("repository","pr_number","by_pr_number");