ALTER TABLE "packages"."package_runs" ADD COLUMN "trigger_source_label" text;
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ADD COLUMN "execution_attempt" integer DEFAULT 0 NOT NULL;
