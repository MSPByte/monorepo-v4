-- Phase 4: tenant-wide form definitions for the MSP agent.
-- `rows` is the display-safe field tree (safe to serve to agents).
-- `psa_mappings` maps field IDs to PSA ticket fields — never sent to agents.
-- Apply with: infra/scripts/tenant-migrate --org=<org-id>

CREATE TABLE IF NOT EXISTS agent.forms (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name         TEXT NOT NULL,
    description  TEXT,
    rows         JSONB NOT NULL DEFAULT '[]',
    psa_mappings JSONB NOT NULL DEFAULT '{}',
    created_by   UUID,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at   TIMESTAMPTZ
);

ALTER TABLE agent.forms ENABLE ROW LEVEL SECURITY;

CREATE POLICY forms_authenticated
  ON agent.forms
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
