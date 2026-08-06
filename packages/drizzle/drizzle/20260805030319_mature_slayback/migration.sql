CREATE SCHEMA "packages";
--> statement-breakpoint
CREATE TABLE "packages"."packages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"steps" jsonb DEFAULT '[]' NOT NULL,
	"author_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packages"."packages" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "packages"."package_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"package_id" uuid NOT NULL,
	"package_version" integer NOT NULL,
	"package_snapshot" jsonb NOT NULL,
	"parent_run_id" uuid,
	"fanout_parent_id" uuid,
	"link_id" uuid,
	"site_id" uuid,
	"trigger_type" text NOT NULL,
	"trigger_ref" jsonb,
	"start_step_index" integer DEFAULT 0 NOT NULL,
	"runtime_inputs" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"bullmq_job_id" text,
	"billing_snapshot" jsonb DEFAULT '{}' NOT NULL,
	"billing_total" numeric(12,4) DEFAULT '0' NOT NULL,
	"outputs_expires_at" timestamp with time zone DEFAULT now() + interval '48 hours' NOT NULL,
	"sensitive_outputs_purged_at" timestamp with time zone,
	"triggered_by_user_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE TABLE "packages"."package_run_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"package_run_id" uuid NOT NULL,
	"position" integer NOT NULL,
	"capability_id" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"skip_reason" text,
	"resolved_inputs" jsonb DEFAULT '{}' NOT NULL,
	"outputs" jsonb DEFAULT '{}' NOT NULL,
	"error_class" text,
	"error_message" text,
	"billable" boolean DEFAULT false NOT NULL,
	"unit_price" numeric(12,4),
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"audit_log_ids" jsonb DEFAULT '[]' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "package_run_steps_run_position" UNIQUE("package_run_id","position")
);
--> statement-breakpoint
ALTER TABLE "packages"."package_run_steps" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE INDEX "packages_status_name_idx" ON "packages"."packages" ("status","name");
--> statement-breakpoint
CREATE INDEX "package_runs_package_created_idx" ON "packages"."package_runs" ("package_id","created_at");
--> statement-breakpoint
CREATE INDEX "package_runs_status_created_idx" ON "packages"."package_runs" ("status","created_at");
--> statement-breakpoint
CREATE INDEX "package_runs_site_created_idx" ON "packages"."package_runs" ("site_id","created_at");
--> statement-breakpoint
CREATE INDEX "package_runs_parent_idx" ON "packages"."package_runs" ("parent_run_id");
--> statement-breakpoint
CREATE INDEX "package_runs_fanout_parent_idx" ON "packages"."package_runs" ("fanout_parent_id");
--> statement-breakpoint
CREATE INDEX "package_runs_ttl_idx" ON "packages"."package_runs" ("outputs_expires_at") WHERE sensitive_outputs_purged_at is null;
--> statement-breakpoint
CREATE INDEX "package_run_steps_run_idx" ON "packages"."package_run_steps" ("package_run_id");
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ADD CONSTRAINT "package_runs_package_id_packages_id_fkey" FOREIGN KEY ("package_id") REFERENCES "packages"."packages"("id") ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ADD CONSTRAINT "package_runs_parent_run_id_package_runs_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "packages"."package_runs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ADD CONSTRAINT "package_runs_fanout_parent_id_package_runs_id_fkey" FOREIGN KEY ("fanout_parent_id") REFERENCES "packages"."package_runs"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ADD CONSTRAINT "package_runs_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "public"."integration_links"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "packages"."package_runs" ADD CONSTRAINT "package_runs_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "public"."sites"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "packages"."package_run_steps" ADD CONSTRAINT "package_run_steps_package_run_id_package_runs_id_fkey" FOREIGN KEY ("package_run_id") REFERENCES "packages"."package_runs"("id") ON DELETE CASCADE;
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "packages"."packages" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "packages"."packages" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "packages"."packages" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "packages"."packages" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "packages"."package_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "packages"."package_runs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "packages"."package_runs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "packages"."package_runs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "packages"."package_run_steps" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "packages"."package_run_steps" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "packages"."package_run_steps" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);
--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "packages"."package_run_steps" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);
