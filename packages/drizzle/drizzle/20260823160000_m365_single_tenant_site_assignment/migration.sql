-- Microsoft 365 tenant eligibility is exclusive per site. The prior mapping
-- migration created the relationship table; this follow-up enforces the rule.
-- Existing conflicts retain the oldest relationship because this rollout is
-- intentionally destructive.
WITH ranked AS (
  SELECT assignment.id,
    row_number() OVER (
      PARTITION BY assignment.site_id
      ORDER BY assignment.created_at ASC, assignment.link_id ASC
    ) AS position
  FROM "integration_link_site_assignments" assignment
  JOIN "integration_links" link ON link.id = assignment.link_id
  WHERE link.integration_id = 'microsoft-365'
)
DELETE FROM "integration_link_site_assignments" assignment
USING ranked
WHERE assignment.id = ranked.id AND ranked.position > 1;--> statement-breakpoint
DELETE FROM "m365_domain_site_mappings" mapping
USING "integration_links" link
WHERE link.id = mapping.link_id
  AND link.integration_id = 'microsoft-365'
  AND NOT EXISTS (
    SELECT 1
    FROM "integration_link_site_assignments" assignment
    WHERE assignment.link_id = mapping.link_id
      AND assignment.site_id = mapping.site_id
  );--> statement-breakpoint
CREATE OR REPLACE FUNCTION "enforce_single_m365_tenant_per_site"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "integration_links" new_link
    WHERE new_link.id = NEW.link_id
      AND new_link.integration_id = 'microsoft-365'
  ) AND EXISTS (
    SELECT 1
    FROM "integration_link_site_assignments" existing_assignment
    JOIN "integration_links" existing_link ON existing_link.id = existing_assignment.link_id
    WHERE existing_assignment.site_id = NEW.site_id
      AND existing_assignment.link_id <> NEW.link_id
      AND existing_link.integration_id = 'microsoft-365'
  ) THEN
    RAISE EXCEPTION 'A site can only be assigned to one Microsoft 365 tenant'
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
DROP TRIGGER IF EXISTS "enforce_single_m365_tenant_per_site" ON "integration_link_site_assignments";--> statement-breakpoint
CREATE TRIGGER "enforce_single_m365_tenant_per_site"
BEFORE INSERT OR UPDATE OF "link_id", "site_id"
ON "integration_link_site_assignments"
FOR EACH ROW EXECUTE FUNCTION "enforce_single_m365_tenant_per_site"();
