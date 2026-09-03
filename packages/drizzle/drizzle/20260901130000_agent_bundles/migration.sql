-- Phase 3: per-site agent config bundle (branding, tray menu, form definitions).
-- Apply with: infra/scripts/tenant-migrate --org=<org-id>

CREATE TABLE IF NOT EXISTS agent.bundles (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id     UUID NOT NULL UNIQUE REFERENCES public.sites(id) ON DELETE CASCADE,
    etag        VARCHAR(64) NOT NULL,
    data        JSONB NOT NULL,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_by  UUID
);

ALTER TABLE agent.bundles ENABLE ROW LEVEL SECURITY;

CREATE POLICY bundles_authenticated
  ON agent.bundles
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
