ALTER TABLE "packages"."packages" ADD COLUMN "failure_actions" jsonb NOT NULL DEFAULT '[]'::jsonb;
