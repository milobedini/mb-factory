CREATE TABLE "stage_changes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"work_item_id" uuid NOT NULL,
	"stage" text NOT NULL,
	"cause" text NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "work_items" ADD COLUMN "estimate" integer;--> statement-breakpoint
ALTER TABLE "stage_changes" ADD CONSTRAINT "stage_changes_work_item_id_work_items_id_fk" FOREIGN KEY ("work_item_id") REFERENCES "public"."work_items"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stage_changes_work_item_idx" ON "stage_changes" USING btree ("work_item_id","at");--> statement-breakpoint
-- Backfill from the stored Linear webhooks, which carry every status change since the first work item (Tastebook's
-- status names). Left out: changes before a work item existed, and the GitHub integration's moves back out of Awaiting
-- Merge (fixed in Linear on 26 Oct).
INSERT INTO "stage_changes" ("work_item_id", "stage", "cause", "at")
SELECT w.id, s.stage, 'backfill', e.received_at
FROM "events" e
JOIN "work_items" w ON w.linear_issue_id = e.payload->'data'->>'id'
CROSS JOIN LATERAL (SELECT CASE
  WHEN e.payload->'data'->'state'->>'type' = 'completed' THEN 'done'
  WHEN e.payload->'data'->'state'->>'type' = 'canceled' THEN 'canceled'
  ELSE CASE e.payload->'data'->'state'->>'name'
    WHEN 'Researching' THEN 'researching' WHEN 'Spec' THEN 'spec' WHEN 'Spec Review' THEN 'spec_review'
    WHEN 'Building' THEN 'building' WHEN 'In Review' THEN 'in_review' WHEN 'Awaiting Merge' THEN 'awaiting_merge'
  END
END AS stage) s
WHERE e.source = 'linear' AND e.type = 'Issue' AND e.action = 'update'
  AND e.payload->'updatedFrom'->'stateId' IS NOT NULL
  AND e.received_at >= w.created_at
  AND s.stage IS NOT NULL
  AND NOT (e.payload->'actor'->>'type' = 'integration' AND s.stage NOT IN ('done', 'canceled'));
--> statement-breakpoint
UPDATE "work_items" w SET "estimate" = (
  SELECT (e.payload->'data'->>'estimate')::integer
  FROM "events" e
  WHERE e.source = 'linear' AND e.type = 'Issue' AND e.payload->'data'->>'id' = w.linear_issue_id
    AND e.payload->'data'->>'estimate' IS NOT NULL
  ORDER BY e.received_at DESC
  LIMIT 1
);
