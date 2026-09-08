-- Sophos returns a firewall's licenses as an array. Keep one projected row
-- per license so report filters can target the product name directly.
ALTER TABLE "vendors"."sophos_firewall_licenses"
  ADD COLUMN "license_identifier" text,
  ADD COLUMN "product_code" text,
  ADD COLUMN "product_name" text,
  ADD COLUMN "product_generic_code" text,
  ADD COLUMN "type" text,
  ADD COLUMN "perpetual" boolean,
  ADD COLUMN "quantity" integer,
  ADD COLUMN "usage_count" integer,
  ADD COLUMN "usage_date" timestamp with time zone,
  ADD COLUMN "usage_collected_at" timestamp with time zone,
  ADD COLUMN "started_at" timestamp with time zone,
  ADD COLUMN "ends_at" timestamp with time zone;
--> statement-breakpoint
INSERT INTO "vendors"."sophos_firewall_licenses" (
  "link_id", "site_id", "external_id", "source_hash", "serial_number",
  "license_identifier", "product_code", "product_name", "product_generic_code",
  "type", "perpetual", "quantity", "usage_count", "usage_date",
  "usage_collected_at", "started_at", "ends_at", "last_seen_at", "created_at", "updated_at"
)
SELECT
  snapshots."link_id",
  snapshots."site_id",
  license.value->>'id',
  NULL,
  snapshots."serial_number",
  COALESCE(license.value->>'licenseIdentifier', license.value->>'id'),
  COALESCE(license.value->'product'->>'code', 'Unknown'),
  COALESCE(license.value->'product'->>'name', license.value->'product'->>'code', 'Unknown'),
  license.value->'product'->>'genericCode',
  COALESCE(license.value->>'type', 'unknown'),
  COALESCE((license.value->>'perpetual')::boolean, false),
  NULLIF(license.value->>'quantity', '')::integer,
  NULLIF(license.value->'usage'->'current'->>'count', '')::integer,
  NULLIF(license.value->'usage'->'current'->>'date', '')::timestamp with time zone,
  NULLIF(license.value->'usage'->'current'->>'collectedAt', '')::timestamp with time zone,
  NULLIF(license.value->>'startDate', '')::timestamp with time zone,
  NULLIF(license.value->>'endDate', '')::timestamp with time zone,
  snapshots."last_seen_at",
  snapshots."created_at",
  snapshots."updated_at"
FROM "vendors"."sophos_firewall_licenses" AS snapshots
CROSS JOIN LATERAL jsonb_array_elements(snapshots."licenses") AS license(value)
WHERE snapshots."external_id" = snapshots."serial_number"
  AND jsonb_typeof(snapshots."licenses") = 'array'
  AND license.value ? 'id'
ON CONFLICT ("link_id", "external_id") DO UPDATE SET
  "license_identifier" = EXCLUDED."license_identifier",
  "product_code" = EXCLUDED."product_code",
  "product_name" = EXCLUDED."product_name",
  "product_generic_code" = EXCLUDED."product_generic_code",
  "type" = EXCLUDED."type",
  "perpetual" = EXCLUDED."perpetual",
  "quantity" = EXCLUDED."quantity",
  "usage_count" = EXCLUDED."usage_count",
  "usage_date" = EXCLUDED."usage_date",
  "usage_collected_at" = EXCLUDED."usage_collected_at",
  "started_at" = EXCLUDED."started_at",
  "ends_at" = EXCLUDED."ends_at",
  "last_seen_at" = EXCLUDED."last_seen_at",
  "updated_at" = EXCLUDED."updated_at";
--> statement-breakpoint
DELETE FROM "vendors"."sophos_firewall_licenses"
WHERE "external_id" = "serial_number";
--> statement-breakpoint
ALTER TABLE "vendors"."sophos_firewall_licenses"
  DROP COLUMN "owner_type",
  DROP COLUMN "model",
  DROP COLUMN "model_type",
  DROP COLUMN "licenses",
  DROP COLUMN "last_checked_at";
--> statement-breakpoint
ALTER TABLE "vendors"."sophos_firewall_licenses"
  ALTER COLUMN "license_identifier" SET NOT NULL,
  ALTER COLUMN "product_code" SET NOT NULL,
  ALTER COLUMN "product_name" SET NOT NULL,
  ALTER COLUMN "type" SET NOT NULL,
  ALTER COLUMN "perpetual" SET NOT NULL;
--> statement-breakpoint
CREATE INDEX "sophos_firewall_licenses_serial_idx"
  ON "vendors"."sophos_firewall_licenses" USING btree ("serial_number");
--> statement-breakpoint
CREATE INDEX "sophos_firewall_licenses_product_name_idx"
  ON "vendors"."sophos_firewall_licenses" USING btree ("product_name");
