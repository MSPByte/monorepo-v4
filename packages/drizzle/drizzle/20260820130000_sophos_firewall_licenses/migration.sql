CREATE TABLE "vendors"."sophos_firewall_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL REFERENCES "public"."integration_links"("id") ON DELETE CASCADE,
	"site_id" uuid REFERENCES "public"."sites"("id"),
	"external_id" text NOT NULL,
	"source_hash" text,
	"serial_number" text NOT NULL,
	"owner_type" text NOT NULL,
	"model" text NOT NULL,
	"model_type" text NOT NULL,
	"licenses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"last_checked_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sophos_firewall_licenses_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."sophos_firewall_licenses" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."sophos_firewall_licenses" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
