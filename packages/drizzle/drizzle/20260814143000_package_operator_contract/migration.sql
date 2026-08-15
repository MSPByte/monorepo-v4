ALTER TABLE "packages"."packages" ADD COLUMN "prompts" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "packages"."packages" ADD COLUMN "outcome_steps" jsonb NOT NULL DEFAULT '{"onSuccess":[],"onFailure":[]}'::jsonb;
