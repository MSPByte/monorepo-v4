ALTER TABLE "packages"."packages" ADD COLUMN "exposed_outputs" jsonb NOT NULL DEFAULT '[]'::jsonb;
--> statement-breakpoint
CREATE TABLE "packages"."package_dependencies" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "parent_package_id" uuid NOT NULL REFERENCES "packages"."packages"("id") ON DELETE CASCADE,
  "child_package_id" uuid NOT NULL REFERENCES "packages"."packages"("id") ON DELETE RESTRICT,
  "step_position" integer NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX "package_dependencies_parent_idx" ON "packages"."package_dependencies" ("parent_package_id");
--> statement-breakpoint
CREATE INDEX "package_dependencies_child_idx" ON "packages"."package_dependencies" ("child_package_id");
--> statement-breakpoint
CREATE UNIQUE INDEX "package_dependencies_parent_step_unique" ON "packages"."package_dependencies" ("parent_package_id", "step_position");
--> statement-breakpoint
ALTER TABLE "packages"."package_dependencies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "packages"."package_dependencies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "packages"."package_dependencies" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "packages"."package_dependencies" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "packages"."package_dependencies" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
