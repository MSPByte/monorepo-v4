-- Form → package automation trigger.
-- package_id: the package launched after the submission's ticket is created.
-- package_bindings: promptKey → AgentFormInputSource (formField | system | literal)
-- resolved into packageRuns.runtimeInputs at submit time by backend/agents.
ALTER TABLE agent.forms
  ADD COLUMN IF NOT EXISTS package_id UUID REFERENCES packages.packages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS package_bindings JSONB NOT NULL DEFAULT '{}'::jsonb;
