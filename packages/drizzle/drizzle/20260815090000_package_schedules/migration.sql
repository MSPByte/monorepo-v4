CREATE TABLE "packages"."package_schedules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "package_id" uuid NOT NULL REFERENCES "packages"."packages"("id") ON DELETE RESTRICT,
  "package_version" integer NOT NULL,
  "package_snapshot" jsonb NOT NULL,
  "link_id" uuid REFERENCES "public"."integration_links"("id") ON DELETE SET NULL,
  "site_id" uuid REFERENCES "public"."sites"("id") ON DELETE SET NULL,
  "runtime_inputs" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "billing_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "scheduled_local_time" text NOT NULL,
  "time_zone" text NOT NULL,
  "scheduled_for" timestamptz NOT NULL,
  "status" text NOT NULL DEFAULT 'scheduled',
  "created_by_user_id" text NOT NULL,
  "canceled_by_user_id" text,
  "canceled_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "package_schedules_due_idx" ON "packages"."package_schedules" ("status", "scheduled_for");
--> statement-breakpoint
CREATE INDEX "package_schedules_package_idx" ON "packages"."package_schedules" ("package_id", "scheduled_for");
--> statement-breakpoint
CREATE INDEX "package_schedules_site_idx" ON "packages"."package_schedules" ("site_id", "scheduled_for");
--> statement-breakpoint
ALTER TABLE "packages"."package_schedules" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "packages"."package_schedules" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "packages"."package_schedules" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "packages"."package_schedules" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "packages"."package_schedules" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ADD COLUMN "schedule_id" uuid REFERENCES "packages"."package_schedules"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ADD CONSTRAINT "package_runs_schedule_unique" UNIQUE ("schedule_id");
