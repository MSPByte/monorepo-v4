-- Evolve agent.bundles from per-site blobs to tenant-wide named configs.
-- Add agent.bundle_assignments for site/site-group scoped assignment.
-- Add token_encrypted to agent.site_tokens for plaintext reveal and CSV export.
-- Apply with: infra/scripts/tenant-migrate --org=<org-id>

-- 1. Evolve agent.bundles: drop site_id, add name/description/is_default/created_at
ALTER TABLE agent.bundles DROP COLUMN IF EXISTS site_id;
ALTER TABLE agent.bundles ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT 'Default Config';
ALTER TABLE agent.bundles ADD COLUMN IF NOT EXISTS description TEXT;
ALTER TABLE agent.bundles ADD COLUMN IF NOT EXISTS is_default BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE agent.bundles ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
-- Remove the DEFAULT on name after backfill so future inserts must supply a name
ALTER TABLE agent.bundles ALTER COLUMN name DROP DEFAULT;

-- 2. New bundle_assignments table: maps a config to a site or site group (one per site, one per group)
CREATE TABLE IF NOT EXISTS agent.bundle_assignments (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    bundle_id       UUID NOT NULL REFERENCES agent.bundles(id) ON DELETE CASCADE,
    site_id         UUID REFERENCES public.sites(id) ON DELETE CASCADE,
    site_group_id   UUID REFERENCES public.site_groups(id) ON DELETE CASCADE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT chk_assignment_target CHECK (
        (site_id IS NOT NULL AND site_group_id IS NULL) OR
        (site_id IS NULL AND site_group_id IS NOT NULL)
    )
);

CREATE UNIQUE INDEX IF NOT EXISTS bundle_assignments_site_unique
    ON agent.bundle_assignments (site_id)
    WHERE site_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS bundle_assignments_site_group_unique
    ON agent.bundle_assignments (site_group_id)
    WHERE site_group_id IS NOT NULL;

ALTER TABLE agent.bundle_assignments ENABLE ROW LEVEL SECURITY;

CREATE POLICY bundle_assignments_authenticated
  ON agent.bundle_assignments
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- 3. Add encrypted token column to agent.site_tokens
ALTER TABLE agent.site_tokens ADD COLUMN IF NOT EXISTS token_encrypted TEXT;
