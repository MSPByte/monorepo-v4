CREATE TABLE "vendors"."sophos_endpoint_migrations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"sophos_migration_id" text NOT NULL UNIQUE,
	"from_link_id" uuid NOT NULL,
	"to_link_id" uuid NOT NULL,
	"from_site_id" uuid,
	"to_site_id" uuid,
	"endpoint_ids" uuid[] NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"requested_count" integer NOT NULL,
	"succeeded_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"finalized_count" integer DEFAULT 0 NOT NULL,
	"initiated_by" uuid,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoint_migrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "sophos_endpoint_migrations_from_link_idx" ON "vendors"."sophos_endpoint_migrations" ("from_link_id");--> statement-breakpoint
CREATE INDEX "sophos_endpoint_migrations_status_idx" ON "vendors"."sophos_endpoint_migrations" ("status");--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoint_migrations" ADD CONSTRAINT "sophos_endpoint_migrations_FUYKMhqKuLTL_fkey" FOREIGN KEY ("from_link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoint_migrations" ADD CONSTRAINT "sophos_endpoint_migrations_to_link_id_integration_links_id_fkey" FOREIGN KEY ("to_link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoint_migrations" ADD CONSTRAINT "sophos_endpoint_migrations_from_site_id_sites_id_fkey" FOREIGN KEY ("from_site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoint_migrations" ADD CONSTRAINT "sophos_endpoint_migrations_to_site_id_sites_id_fkey" FOREIGN KEY ("to_site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoint_migrations" ADD CONSTRAINT "sophos_endpoint_migrations_initiated_by_users_id_fkey" FOREIGN KEY ("initiated_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."sophos_endpoint_migrations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."sophos_endpoint_migrations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."sophos_endpoint_migrations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."sophos_endpoint_migrations" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);