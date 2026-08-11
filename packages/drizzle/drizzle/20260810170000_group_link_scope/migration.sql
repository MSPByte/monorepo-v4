CREATE TABLE "site_group_link_members" (
	"site_group_id" uuid NOT NULL,
	"integration_link_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_group_link_members_unique" UNIQUE("site_group_id","integration_link_id")
);
--> statement-breakpoint
ALTER TABLE "site_group_link_members" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE "site_group_link_members" ADD CONSTRAINT "site_group_link_members_site_group_id_site_groups_id_fkey" FOREIGN KEY ("site_group_id") REFERENCES "site_groups"("id") ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE "site_group_link_members" ADD CONSTRAINT "site_group_link_members_integration_link_id_integration_links_id_fkey" FOREIGN KEY ("integration_link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE INDEX "site_group_link_members_link_idx" ON "site_group_link_members" USING btree ("integration_link_id");
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "site_group_link_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "site_group_link_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "site_group_link_members" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "site_group_link_members" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
--> statement-breakpoint
ALTER TABLE "packages"."packages" ADD COLUMN "allowed_integration_links" jsonb NOT NULL DEFAULT '[]'::jsonb;
