-- Add ticket template columns to agent.forms.
-- ticketTitle / ticketBody are Mustache-style templates: {{hydrationKey}} is
-- substituted with the submitted field value at ticket-creation time.
ALTER TABLE agent.forms
  ADD COLUMN IF NOT EXISTS ticket_title TEXT,
  ADD COLUMN IF NOT EXISTS ticket_body  TEXT;
