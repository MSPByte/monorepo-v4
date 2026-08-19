CREATE SCHEMA "reports";
--> statement-breakpoint
CREATE TABLE "reports"."reports" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "source" text NOT NULL,
  "definition" jsonb NOT NULL,
  "created_by" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "reports_source_idx" ON "reports"."reports" ("source");
--> statement-breakpoint
CREATE INDEX "reports_created_by_idx" ON "reports"."reports" ("created_by");
--> statement-breakpoint
ALTER TABLE "reports"."reports" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "reports"."reports" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "reports"."reports" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "reports"."reports" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "reports"."reports" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
--> statement-breakpoint
CREATE TABLE "reports"."dashboards" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "description" text,
  "layout" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_by" uuid REFERENCES "public"."users"("id") ON DELETE SET NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "dashboards_created_by_idx" ON "reports"."dashboards" ("created_by");
--> statement-breakpoint
ALTER TABLE "reports"."dashboards" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "reports"."dashboards" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "reports"."dashboards" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "reports"."dashboards" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "reports"."dashboards" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
--> statement-breakpoint
CREATE TABLE "reports"."dashboard_tiles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "dashboard_id" uuid NOT NULL REFERENCES "reports"."dashboards"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "kind" text NOT NULL,
  "report_id" uuid REFERENCES "reports"."reports"("id") ON DELETE SET NULL,
  "inline_def" jsonb,
  "viz" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "dashboard_tiles_dashboard_idx" ON "reports"."dashboard_tiles" ("dashboard_id");
--> statement-breakpoint
CREATE INDEX "dashboard_tiles_report_idx" ON "reports"."dashboard_tiles" ("report_id");
--> statement-breakpoint
ALTER TABLE "reports"."dashboard_tiles" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "reports"."dashboard_tiles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "reports"."dashboard_tiles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "reports"."dashboard_tiles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "reports"."dashboard_tiles" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
--> statement-breakpoint
CREATE TABLE "reports"."user_report_prefs" (
  "user_id" uuid PRIMARY KEY REFERENCES "public"."users"("id") ON DELETE CASCADE,
  "landing_dashboard_id" uuid REFERENCES "reports"."dashboards"("id") ON DELETE SET NULL,
  "scope_kind" text NOT NULL DEFAULT 'all',
  "scope_ids" uuid[] NOT NULL DEFAULT '{}',
  "favorite_report_ids" uuid[] NOT NULL DEFAULT '{}',
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "reports"."user_report_prefs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "reports"."user_report_prefs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "reports"."user_report_prefs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "reports"."user_report_prefs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "reports"."user_report_prefs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
