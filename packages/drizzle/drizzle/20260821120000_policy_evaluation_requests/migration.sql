CREATE TABLE "policy"."policy_evaluation_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" text NOT NULL,
  "link_id" uuid NOT NULL REFERENCES "public"."integration_links"("id") ON DELETE CASCADE,
  "site_id" uuid REFERENCES "public"."sites"("id") ON DELETE SET NULL,
  "integration_id" text NOT NULL,
  "type" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'queued')),
  "bullmq_job_id" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "policy_eval_req_status_idx" ON "policy"."policy_evaluation_requests" ("status");
--> statement-breakpoint
ALTER TABLE "policy"."policy_evaluation_requests" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "policy_evaluation_requests_crud" ON "policy"."policy_evaluation_requests"
  FOR ALL TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE "ingestor"."sync_runs" DROP CONSTRAINT IF EXISTS "valid_mode";
--> statement-breakpoint
ALTER TABLE "ingestor"."sync_runs" ADD CONSTRAINT "valid_mode" CHECK (mode IN ('full', 'incremental', 'policy-trigger'));
