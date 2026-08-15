ALTER TABLE "packages"."packages" ADD COLUMN "prompts" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "packages"."packages" ADD COLUMN "outcome_steps" jsonb NOT NULL DEFAULT '{"onSuccess":[],"onFailure":[]}'::jsonb;

ALTER TABLE "packages"."package_run_steps" ADD COLUMN "lane" text NOT NULL DEFAULT 'main';
ALTER TABLE "packages"."package_run_steps" DROP CONSTRAINT "package_run_steps_run_position";
ALTER TABLE "packages"."package_run_steps" ADD CONSTRAINT "package_run_steps_run_lane_position" UNIQUE("package_run_id", "lane", "position");
