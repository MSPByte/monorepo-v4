CREATE TABLE "user_role_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"user_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"scope_kind" text NOT NULL,
	"scope_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_role_grants_uniq" UNIQUE("user_id","role_id","scope_kind","scope_ids")
);
--> statement-breakpoint
ALTER TABLE "user_role_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "permissions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "roles" ADD COLUMN "is_system" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "user_role_grants_user_id_idx" ON "user_role_grants" ("user_id");--> statement-breakpoint
ALTER TABLE "user_role_grants" ADD CONSTRAINT "user_role_grants_user_id_users_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "user_role_grants" ADD CONSTRAINT "user_role_grants_role_id_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT;--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "user_role_grants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "user_role_grants" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "user_role_grants" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "user_role_grants" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint

-- Data migration: backfill user_role_grants from legacy users.role_id. Every
-- user with a role_id becomes a single grant scoped 'all'. Idempotent — re-runs
-- skip rows already present.
INSERT INTO "user_role_grants" ("user_id", "role_id", "scope_kind", "scope_ids")
SELECT u."id", u."role_id", 'all', '{}'::uuid[]
FROM "users" u
WHERE u."role_id" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "user_role_grants" g
    WHERE g."user_id" = u."id" AND g."role_id" = u."role_id"
  );--> statement-breakpoint

-- Data migration: translate legacy roles.attributes (boolean bag) to
-- roles.permissions (dotted-path array).
--   * = true            → ['*']  (Owner-seed shape)
--   Global.Admin = true → ['*']  (functionally equivalent to '*')
--   otherwise           → array of every key whose value is true, excluding
--                         the two sentinels above.
-- Guard on cardinality(permissions)=0 so re-runs and Stage-3 seeder writes are
-- not overwritten.
UPDATE "roles"
SET
  "permissions" = CASE
    WHEN ("attributes" ? '*' AND ("attributes" ->> '*')::boolean = true)
      OR ("attributes" ? 'Global.Admin' AND ("attributes" ->> 'Global.Admin')::boolean = true)
      THEN ARRAY['*']::text[]
    ELSE COALESCE(
      (
        SELECT array_agg(kv.key)
        FROM jsonb_each_text("attributes") AS kv
        WHERE kv.value = 'true' AND kv.key NOT IN ('*', 'Global.Admin')
      ),
      '{}'::text[]
    )
  END,
  "updated_at" = now()
WHERE cardinality("permissions") = 0;
