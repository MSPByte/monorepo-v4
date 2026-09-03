-- Phase 1: core agent schema — agents, logs, tickets.
-- machine_id/serial/username/sid/last_checkin_at are added in 20260901120000.
-- Apply with: infra/scripts/tenant-migrate --org=<org-id>

CREATE SCHEMA IF NOT EXISTS agent;

CREATE TABLE IF NOT EXISTS agent.agents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    site_id         UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    hostname        TEXT NOT NULL,
    platform        TEXT NOT NULL,
    version         TEXT NOT NULL,
    ip_address      TEXT,
    ext_address     TEXT,
    mac_address     TEXT,
    registered_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at      TIMESTAMPTZ
);

ALTER TABLE agent.agents ENABLE ROW LEVEL SECURITY;

CREATE POLICY agents_authenticated
  ON agent.agents
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);

CREATE TABLE IF NOT EXISTS agent.logs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id        UUID NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
    site_id         UUID REFERENCES public.sites(id) ON DELETE CASCADE,
    method          TEXT NOT NULL,
    message         TEXT NOT NULL,
    status          INTEGER NOT NULL,
    time_elapsed_ms INTEGER NOT NULL,
    metadata        JSONB,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent.logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY logs_authenticated
  ON agent.logs
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (false);

CREATE TABLE IF NOT EXISTS agent.tickets (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id    UUID NOT NULL REFERENCES agent.agents(id) ON DELETE CASCADE,
    site_id     UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
    ticket_id   TEXT NOT NULL,
    summary     TEXT,
    meta        JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE agent.tickets ENABLE ROW LEVEL SECURITY;

CREATE POLICY tickets_authenticated
  ON agent.tickets
  FOR ALL
  TO authenticated
  USING (true)
  WITH CHECK (true);
