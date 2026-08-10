CREATE TABLE "policy"."policy_dependencies" (
	"parent_policy_id" text NOT NULL,
	"child_policy_id" text NOT NULL,
	"relationship_type" text DEFAULT 'blocks' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_dependencies_unique" UNIQUE("parent_policy_id","child_policy_id","relationship_type")
);
--> statement-breakpoint
ALTER TABLE "policy"."policy_dependencies" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX "policy_dependencies_parent_idx" ON "policy"."policy_dependencies" ("parent_policy_id");
--> statement-breakpoint
CREATE INDEX "policy_dependencies_child_idx" ON "policy"."policy_dependencies" ("child_policy_id");
--> statement-breakpoint
ALTER TABLE "policy"."policy_dependencies" ADD CONSTRAINT "policy_dependencies_parent_policy_id_policies_id_fkey" FOREIGN KEY ("parent_policy_id") REFERENCES "policy"."policies"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "policy"."policy_dependencies" ADD CONSTRAINT "policy_dependencies_child_policy_id_policies_id_fkey" FOREIGN KEY ("child_policy_id") REFERENCES "policy"."policies"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "policy"."policy_dependencies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "policy"."policy_dependencies" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "policy"."policy_dependencies" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "policy"."policy_dependencies" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
