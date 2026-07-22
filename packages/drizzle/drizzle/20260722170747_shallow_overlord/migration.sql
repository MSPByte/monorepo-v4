CREATE SCHEMA "agent";
--> statement-breakpoint
CREATE SCHEMA "audit";
--> statement-breakpoint
CREATE SCHEMA "billing";
--> statement-breakpoint
CREATE SCHEMA "canonical";
--> statement-breakpoint
CREATE SCHEMA "ingestor";
--> statement-breakpoint
CREATE SCHEMA "policy";
--> statement-breakpoint
CREATE SCHEMA "vendors";
--> statement-breakpoint
CREATE SCHEMA "wiki";
--> statement-breakpoint
CREATE TYPE "e_site_fact_source" AS ENUM('generated', 'user_options', 'user_free', 'user_flex');--> statement-breakpoint
CREATE TYPE "audit"."e_audit_actions" AS ENUM('create', 'update', 'delete');--> statement-breakpoint
CREATE TYPE "audit"."e_audit_actor" AS ENUM('user', 'system');--> statement-breakpoint
CREATE TYPE "audit"."e_audit_result" AS ENUM('success', 'failure', 'partial');--> statement-breakpoint
CREATE TYPE "wiki"."e_article_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TABLE "integration_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"integration_id" text NOT NULL,
	"site_id" uuid,
	"external_id" text,
	"name" text,
	"status" text DEFAULT 'active',
	"disposition" text,
	"note" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "integration_links_integration_id_external_id_unique" UNIQUE("integration_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "integration_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY,
	"config" jsonb NOT NULL,
	"credential_expiration" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "integrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL UNIQUE,
	"description" text,
	"level" integer DEFAULT 0 NOT NULL,
	"attributes" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"auth_user_id" text NOT NULL UNIQUE,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role_id" uuid,
	"preferences" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_group_members" (
	"site_group_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "site_group_members_unique" UNIQUE("site_group_id","site_id")
);
--> statement-breakpoint
ALTER TABLE "site_group_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL CONSTRAINT "site_groups_name_unique" UNIQUE,
	"description" text,
	"attributes" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "sites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"description" text,
	"attributes" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sites" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_profile_facts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"site_id" uuid NOT NULL,
	"field_id" uuid,
	"key" text NOT NULL,
	"source" "e_site_fact_source" NOT NULL,
	"origin" text DEFAULT 'manual' NOT NULL,
	"value" jsonb,
	"confidence" text,
	"applicable" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_site_key" UNIQUE("key","site_id")
);
--> statement-breakpoint
ALTER TABLE "site_profile_facts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_profile_options" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" text NOT NULL CONSTRAINT "unique_site_profile_options_key" UNIQUE,
	"active" boolean NOT NULL,
	"label" text NOT NULL,
	"display_order" integer DEFAULT 0,
	"section" text NOT NULL,
	"type" text NOT NULL,
	"value_mode" text DEFAULT 'single' NOT NULL,
	"values" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_profile_options" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_profile_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"site_id" uuid NOT NULL,
	"active" boolean NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"severity" integer NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "site_profile_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "site_stack_categories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"key" text NOT NULL CONSTRAINT "unique_site_stack_categories_key" UNIQUE,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"required" boolean DEFAULT true NOT NULL,
	"display_order" integer DEFAULT 0 NOT NULL,
	"metadata_fields" jsonb
);
--> statement-breakpoint
CREATE TABLE "site_stack_entries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"site_id" uuid NOT NULL,
	"category_id" uuid,
	"canonical_id" uuid,
	"link_id" uuid,
	"key" text NOT NULL,
	"vendor" text,
	"product" text,
	"status" text NOT NULL,
	"notes" text,
	"metadata" jsonb,
	"source" text NOT NULL,
	"origin" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_site_stack_entry_site_key" UNIQUE("site_id","key")
);
--> statement-breakpoint
ALTER TABLE "site_stack_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" uuid NOT NULL,
	"site_id" uuid,
	"method" text NOT NULL,
	"message" text NOT NULL,
	"status" integer NOT NULL,
	"time_elapsed_ms" integer NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."tickets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"agent_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"ticket_id" text NOT NULL,
	"summary" text,
	"meta" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "agent"."tickets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "agent"."agents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"site_id" uuid NOT NULL,
	"hostname" text NOT NULL,
	"platform" text NOT NULL,
	"version" text NOT NULL,
	"ip_address" text,
	"ext_address" text,
	"mac_address" text,
	"registered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent"."agents" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "audit"."customer_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"site_id" uuid,
	"actor_type" "audit"."e_audit_actor" NOT NULL,
	"actor_id" text NOT NULL,
	"actor_label" text NOT NULL,
	"action" "audit"."e_audit_actions" NOT NULL,
	"action_label" text,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"target_label" text NOT NULL,
	"result" "audit"."e_audit_result" NOT NULL,
	"error_message" text,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit"."customer_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."psa_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source_provider" text NOT NULL,
	"source_table" text NOT NULL,
	"source_id" uuid,
	"link_id" uuid,
	"site_id" uuid,
	"external_id" text NOT NULL,
	"customer_name" text,
	"contract_name" text,
	"item_name" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric(12,2) DEFAULT '0' NOT NULL,
	"cost" numeric(12,2),
	"recurring_period" text,
	"raw_summary" jsonb DEFAULT '{}' NOT NULL,
	"deleted_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "psa_items_source_provider_link_id_external_id_unique" UNIQUE("source_provider","link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "billing"."psa_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."reconciliation_results" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"run_id" uuid NOT NULL,
	"site_id" uuid,
	"psa_item_id" uuid,
	"rule_id" uuid,
	"billed_quantity" integer DEFAULT 0 NOT NULL,
	"actual_quantity" integer DEFAULT 0 NOT NULL,
	"diff_quantity" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric(12,2) DEFAULT '0' NOT NULL,
	"monthly_delta" numeric(12,2) DEFAULT '0' NOT NULL,
	"status" text NOT NULL,
	"evidence" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_results" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."reconciliation_rule_scopes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"rule_id" uuid NOT NULL,
	"mode" text NOT NULL,
	"target_type" text NOT NULL,
	"site_id" uuid,
	"site_group_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_rule_scopes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."reconciliation_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"site_id" uuid,
	"psa_item_match" jsonb DEFAULT '{}' NOT NULL,
	"vendor_provider" text NOT NULL,
	"vendor_facet" text NOT NULL,
	"vendor_filters" jsonb DEFAULT '[]' NOT NULL,
	"count_mode" text DEFAULT 'count_rows' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "billing"."reconciliation_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"status" text NOT NULL,
	"trigger" text NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "canonical"."assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"site_id" uuid,
	"display_name" text NOT NULL,
	"hostname" text,
	"serial_number" text,
	"os" text,
	"asset_type" text DEFAULT 'unknown' NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"source_confidence" text DEFAULT 'medium' NOT NULL,
	"attributes" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "canonical"."assets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "canonical"."entity_sources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"canonical_type" text NOT NULL,
	"canonical_id" uuid NOT NULL,
	"vendor_table" text NOT NULL,
	"vendor_record_id" uuid NOT NULL,
	"link_id" uuid,
	"site_id" uuid,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"external_id" text NOT NULL,
	"confidence" integer NOT NULL,
	"match_method" text NOT NULL,
	"match_evidence" jsonb DEFAULT '{}' NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"manually_confirmed_at" timestamp with time zone,
	"manually_rejected_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entity_sources_vendor_record" UNIQUE("vendor_table","vendor_record_id")
);
--> statement-breakpoint
ALTER TABLE "canonical"."entity_sources" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "canonical"."people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"site_id" uuid,
	"primary_email" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text DEFAULT 'unknown' NOT NULL,
	"source_confidence" text DEFAULT 'high' NOT NULL,
	"attributes" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_site_email" UNIQUE("site_id","primary_email")
);
--> statement-breakpoint
ALTER TABLE "canonical"."people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingestor"."raw_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"sync_run_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"mode" text NOT NULL,
	"batch_index" integer NOT NULL,
	"cursor_in" text,
	"cursor_out" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"record_count" integer DEFAULT 0 NOT NULL,
	"projected_at" timestamp with time zone,
	"projection_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_batches_run_type_index" UNIQUE("sync_run_id","link_id","type","batch_index"),
	CONSTRAINT "raw_batches_valid_mode" CHECK (mode in ('full', 'incremental'))
);
--> statement-breakpoint
ALTER TABLE "ingestor"."raw_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingestor"."raw_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"raw_batch_id" uuid NOT NULL,
	"sync_run_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"provider" text NOT NULL,
	"type" text NOT NULL,
	"external_id" text NOT NULL,
	"op" text DEFAULT 'upsert' NOT NULL,
	"payload_hash" text NOT NULL,
	"schema_version" text DEFAULT '1' NOT NULL,
	"payload" jsonb NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	"projected_at" timestamp with time zone,
	"projection_status" text DEFAULT 'pending' NOT NULL,
	"projection_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_records_batch_external" UNIQUE("raw_batch_id","external_id"),
	CONSTRAINT "raw_records_valid_op" CHECK (op in ('upsert', 'delete'))
);
--> statement-breakpoint
ALTER TABLE "ingestor"."raw_records" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingestor"."sync_context" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"integration_id" text NOT NULL,
	"type" text NOT NULL,
	"cursor" text,
	"full_sync_at" timestamp with time zone,
	"incremental_sync_at" timestamp with time zone,
	"consecutive_failures" integer DEFAULT 0 NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_failure_at" timestamp with time zone,
	"last_error_class" text,
	"last_error_message" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_sync_context" UNIQUE("link_id","integration_id","type")
);
--> statement-breakpoint
ALTER TABLE "ingestor"."sync_context" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingestor"."sync_run_stages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"sync_run_id" uuid NOT NULL,
	"integration_id" text NOT NULL,
	"bullmq_job_id" text NOT NULL,
	"type" text NOT NULL,
	"stage" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"records_in" integer DEFAULT 0 NOT NULL,
	"records_out" integer DEFAULT 0 NOT NULL,
	"created_ct" integer DEFAULT 0 NOT NULL,
	"updated_ct" integer DEFAULT 0 NOT NULL,
	"failed_ct" integer DEFAULT 0 NOT NULL,
	"metrics" jsonb,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ingestor"."sync_run_stages" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ingestor"."sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"integration_id" text NOT NULL,
	"bullmq_job_id" text NOT NULL,
	"type" text NOT NULL,
	"status" text NOT NULL,
	"mode" text NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "valid_mode" CHECK (mode in ('full', 'incremental'))
);
--> statement-breakpoint
ALTER TABLE "ingestor"."sync_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "policy"."findings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"policy_id" text NOT NULL,
	"policy_set_id" uuid,
	"policy_assignment_id" uuid,
	"provider_id" text,
	"link_id" uuid,
	"site_id" uuid,
	"resource_type" text NOT NULL,
	"resource_table" text,
	"resource_id" text NOT NULL,
	"resource_external_id" text,
	"fingerprint" text NOT NULL CONSTRAINT "findings_fingerprint_unique" UNIQUE,
	"title" text NOT NULL,
	"summary" text,
	"severity" integer NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"evidence" jsonb DEFAULT '{}' NOT NULL,
	"impact" jsonb DEFAULT '{}' NOT NULL,
	"remediation" jsonb DEFAULT '{}' NOT NULL,
	"recommendation" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"suppressed_until" timestamp with time zone,
	"suppressed_at" timestamp with time zone,
	"suppression_reason" text,
	"suppressed_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy"."findings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "policy"."policies" (
	"id" text PRIMARY KEY,
	"source" text DEFAULT 'custom' NOT NULL,
	"source_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"category" text,
	"provider_id" text,
	"target_type" text NOT NULL,
	"severity" integer NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"recommendation" text,
	"definition" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy"."policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "policy"."assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"subject_type" text DEFAULT 'policy' NOT NULL,
	"policy_id" text,
	"policy_set_id" uuid,
	"scope_type" text DEFAULT 'global' NOT NULL,
	"site_id" uuid,
	"site_group_id" uuid,
	"link_id" uuid,
	"enabled" boolean DEFAULT true NOT NULL,
	"parameters" jsonb DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy"."assignments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "policy"."policy_set_items" (
	"policy_set_id" uuid NOT NULL,
	"policy_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "policy_set_items_unique" UNIQUE("policy_set_id","policy_id")
);
--> statement-breakpoint
ALTER TABLE "policy"."policy_set_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "policy"."policy_sets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"source" text DEFAULT 'custom' NOT NULL,
	"source_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"name" text NOT NULL CONSTRAINT "policy_sets_name" UNIQUE,
	"description" text,
	"category" text,
	"provider_id" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "policy"."policy_sets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_hash" text,
	"display_name" text NOT NULL,
	"operating_system" text,
	"operating_system_version" text,
	"is_compliant" boolean,
	"is_managed" boolean,
	"device_ownership" text,
	"approximate_last_sign_in_at" timestamp with time zone,
	"registered_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_devices_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_domain_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"domain_name" text NOT NULL,
	"spf_record" text,
	"spf_is_permissive" boolean,
	"dmarc_record" text,
	"dmarc_policy" text,
	"dkim_enabled" boolean,
	"dkim_selector1_present" boolean,
	"dkim_selector2_present" boolean,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_domain_config_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_domain_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_exchange_configs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"reject_direct_send" boolean NOT NULL,
	"auto_forwarding_mode" text,
	"allow_basic_auth_smtp" boolean,
	"forwarding_mailboxes" jsonb,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_exchange_configs_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_exchange_configs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_hash" text,
	"name" text NOT NULL,
	"description" text,
	"mail_enabled" boolean NOT NULL,
	"security_enabled" boolean NOT NULL,
	"member_external_ids" text[],
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_groups_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"external_id" text NOT NULL,
	"source_hash" text,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"type" text NOT NULL,
	"enabled" boolean NOT NULL,
	"mfa_enforced" boolean DEFAULT false NOT NULL,
	"assigned_licenses" text[],
	"assigned_role_template_ids" text[],
	"last_sign_in_at" timestamp with time zone,
	"last_non_interactive_sign_in_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_identities_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_identity_groups" (
	"identity_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_identity_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_identity_roles" (
	"identity_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_identity_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_inbox_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"mailbox_upn" text NOT NULL,
	"rule_name" text NOT NULL,
	"rule_identity" text,
	"enabled" boolean,
	"delete_message" boolean,
	"move_to_folder" text,
	"forward_to" text[],
	"forward_as_attachment_to" text[],
	"redirect_to" text[],
	"mark_as_read" boolean,
	"subject_contains_words" text[],
	"is_suspicious" boolean DEFAULT false NOT NULL,
	"suspicion_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_inbox_rules_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_inbox_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_hash" text,
	"sku_id" text NOT NULL,
	"sku_part_number" text NOT NULL,
	"friendly_name" text NOT NULL,
	"enabled" boolean NOT NULL,
	"total_units" integer NOT NULL,
	"consumed_units" integer NOT NULL,
	"locked_out_units" integer DEFAULT 0 NOT NULL,
	"warning_units" integer DEFAULT 0 NOT NULL,
	"suspended_units" integer DEFAULT 0 NOT NULL,
	"service_plan_names" text[],
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_licenses_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_licenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_mailbox_forwarding" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"user_principal_name" text NOT NULL,
	"forwarding_address" text,
	"forwarding_smtp_address" text,
	"deliver_to_mailbox_and_forward" boolean,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_mailbox_forwarding_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_mailbox_forwarding" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_oauth_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_hash" text,
	"client_id" text NOT NULL,
	"client_display_name" text,
	"consent_type" text NOT NULL,
	"principal_id" text,
	"resource_id" text NOT NULL,
	"resource_display_name" text,
	"scope" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_oauth_grants_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_oauth_grants" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_hash" text,
	"name" text NOT NULL,
	"description" text,
	"policy_state" text NOT NULL,
	"conditions" jsonb,
	"grant_controls" jsonb,
	"session_controls" jsonb,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_policies_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_policies" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_policy_groups" (
	"policy_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"included" boolean NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_policy_identities" (
	"policy_id" uuid NOT NULL,
	"identity_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"included" boolean NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_identities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_policy_roles" (
	"policy_id" uuid NOT NULL,
	"role_id" uuid NOT NULL,
	"link_id" uuid NOT NULL,
	"included" boolean NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_risky_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"source_hash" text,
	"user_principal_name" text NOT NULL,
	"user_display_name" text,
	"risk_level" text NOT NULL,
	"risk_state" text NOT NULL,
	"risk_detail" text,
	"risk_last_updated_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_risky_users_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_risky_users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_roles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"external_id" text NOT NULL,
	"template_id" text NOT NULL UNIQUE,
	"name" text NOT NULL,
	"description" text
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."m365_teams_config" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"allow_anonymous_users_to_join_meeting" boolean,
	"allow_external_participant_give_request_control" boolean,
	"allow_pstn_users_to_bypass_lobby" boolean,
	"auto_admitted_users" text,
	"allow_federated_users" boolean,
	"allow_public_users" boolean,
	"allow_teams_consumer" boolean,
	"allowed_domains" text[],
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "m365_teams_config_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."m365_teams_config" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."sophos_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"external_id" text NOT NULL,
	"source_hash" text,
	"hostname" text NOT NULL,
	"type" text NOT NULL,
	"platform" text NOT NULL,
	"os_name" text NOT NULL,
	"health" text NOT NULL,
	"online" boolean NOT NULL,
	"needs_upgrade" boolean NOT NULL,
	"has_mdr" boolean NOT NULL,
	"tamper_protection_enabled" boolean NOT NULL,
	"lockdown" text NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sophos_endpoints_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."sophos_firewalls" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"external_id" text NOT NULL,
	"source_hash" text,
	"name" text NOT NULL,
	"hostname" text NOT NULL,
	"model" text NOT NULL,
	"serial_number" text NOT NULL,
	"firmware_version" text NOT NULL,
	"external_ip" text NOT NULL,
	"connected" boolean NOT NULL,
	"suspended" boolean NOT NULL,
	"managing" text NOT NULL,
	"reporting" text NOT NULL,
	"upgrade_to_version" text,
	"last_change_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sophos_firewalls_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."sophos_firewalls" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."sophos_licenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"external_id" text NOT NULL,
	"source_hash" text,
	"license_id" text NOT NULL,
	"code" text NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"perpetual" boolean NOT NULL,
	"unlimited" boolean NOT NULL,
	"quantity" integer,
	"usage_count" integer,
	"started_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sophos_licenses_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."sophos_licenses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."sophos_tamper_protection" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"endpoint_id" uuid NOT NULL UNIQUE,
	"password" text NOT NULL,
	"previous" text[] DEFAULT '{}'::text[] NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "vendors"."sophos_tamper_protection" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."datto_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"external_id" text NOT NULL,
	"source_hash" text,
	"hostname" text NOT NULL,
	"category" text NOT NULL,
	"os" text NOT NULL,
	"ip_address" text NOT NULL,
	"ext_address" text NOT NULL,
	"online" boolean NOT NULL,
	"udfs" jsonb DEFAULT '{}' NOT NULL,
	"last_reboot_at" timestamp with time zone NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "datto_endpoints_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."datto_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."cove_endpoints" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"external_id" text NOT NULL,
	"source_hash" text,
	"endpoint_name" text NOT NULL,
	"hostname" text NOT NULL,
	"type" text NOT NULL,
	"profile" text NOT NULL,
	"retention_policy" text NOT NULL,
	"status" text NOT NULL,
	"lsv_status" text,
	"errors" integer DEFAULT 0 NOT NULL,
	"selected_size" bigint DEFAULT 0 NOT NULL,
	"used_storage" bigint DEFAULT 0 NOT NULL,
	"last_28_days" text NOT NULL,
	"last_success_at" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cove_endpoints_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."cove_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "vendors"."halopsa_recurring_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"link_id" uuid NOT NULL,
	"site_id" uuid,
	"external_id" text NOT NULL,
	"external_client_id" text,
	"external_site_id" text,
	"external_contract_id" text,
	"external_invoice_id" text,
	"external_item_id" text,
	"item_name" text NOT NULL,
	"description" text,
	"quantity" integer DEFAULT 0 NOT NULL,
	"unit_price" numeric(12,2) DEFAULT '0' NOT NULL,
	"cost" numeric(12,2),
	"recurring_period" text,
	"source_hash" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "halopsa_recurring_items_link_id_external_id_unique" UNIQUE("link_id","external_id")
);
--> statement-breakpoint
ALTER TABLE "vendors"."halopsa_recurring_items" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."article_contexts" (
	"article_id" uuid,
	"context_id" uuid,
	"relationship" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_contexts_pkey" PRIMARY KEY("article_id","context_id")
);
--> statement-breakpoint
CREATE TABLE "wiki"."article_drafts" (
	"article_id" uuid PRIMARY KEY,
	"base_version_id" uuid,
	"title" text NOT NULL,
	"primary_context_id" uuid NOT NULL,
	"linked_context_ids" jsonb DEFAULT '[]' NOT NULL,
	"tag_ids" jsonb DEFAULT '[]' NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"change_note" text,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."article_drafts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."article_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"article_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text NOT NULL,
	"relationship" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_article_target_relationship" UNIQUE("article_id","target_type","target_id","relationship")
);
--> statement-breakpoint
ALTER TABLE "wiki"."article_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."article_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"article_id" uuid NOT NULL,
	"site_id" uuid NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"search_vector" tsvector,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_article_site" UNIQUE("article_id","site_id")
);
--> statement-breakpoint
ALTER TABLE "wiki"."article_overrides" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."article_references" (
	"source_article_id" uuid,
	"target_article_id" uuid,
	"source_version_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_references_pkey" PRIMARY KEY("source_article_id","target_article_id")
);
--> statement-breakpoint
ALTER TABLE "wiki"."article_references" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."article_tags" (
	"article_id" uuid,
	"tag_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_tags_pkey" PRIMARY KEY("article_id","tag_id")
);
--> statement-breakpoint
ALTER TABLE "wiki"."article_tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."article_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"article_id" uuid NOT NULL,
	"version_number" integer NOT NULL,
	"title" text NOT NULL,
	"primary_context_id" uuid,
	"content_json" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"change_note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_article_version" UNIQUE("article_id","version_number")
);
--> statement-breakpoint
ALTER TABLE "wiki"."article_versions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"kb_number" integer NOT NULL UNIQUE,
	"primary_context_id" uuid NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"status" "wiki"."e_article_status" DEFAULT 'published'::"wiki"."e_article_status" NOT NULL,
	"content_json" jsonb NOT NULL,
	"content_text" text NOT NULL,
	"search_vector" tsvector,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."articles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."contexts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"parent_id" uuid,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unique_pid_slug" UNIQUE("parent_id","slug")
);
--> statement-breakpoint
ALTER TABLE "wiki"."contexts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."edit_locks" (
	"resource_type" text,
	"resource_id" uuid,
	"locked_by" uuid NOT NULL,
	"locked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	CONSTRAINT "edit_locks_pkey" PRIMARY KEY("resource_type","resource_id")
);
--> statement-breakpoint
ALTER TABLE "wiki"."edit_locks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "wiki"."tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"color" text NOT NULL,
	"description" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "wiki"."tags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE INDEX "integration_links_status_idx" ON "integration_links" ("status");--> statement-breakpoint
CREATE INDEX "site_group_members_site_idx" ON "site_group_members" ("site_id");--> statement-breakpoint
CREATE INDEX "billing_psa_items_site_idx" ON "billing"."psa_items" ("site_id");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_results_run_idx" ON "billing"."reconciliation_results" ("run_id");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_results_site_idx" ON "billing"."reconciliation_results" ("site_id");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_rule_scopes_rule_idx" ON "billing"."reconciliation_rule_scopes" ("rule_id");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_rule_scopes_site_idx" ON "billing"."reconciliation_rule_scopes" ("site_id");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_rule_scopes_group_idx" ON "billing"."reconciliation_rule_scopes" ("site_group_id");--> statement-breakpoint
CREATE INDEX "billing_reconciliation_rules_site_idx" ON "billing"."reconciliation_rules" ("site_id");--> statement-breakpoint
CREATE INDEX "assets_site_hostname_idx" ON "canonical"."assets" ("site_id","hostname");--> statement-breakpoint
CREATE INDEX "assets_site_serial_idx" ON "canonical"."assets" ("site_id","serial_number");--> statement-breakpoint
CREATE INDEX "entity_sources_canonical_idx" ON "canonical"."entity_sources" ("canonical_type","canonical_id");--> statement-breakpoint
CREATE INDEX "entity_sources_lookup_idx" ON "canonical"."entity_sources" ("provider","type","external_id");--> statement-breakpoint
CREATE INDEX "people_email_idx" ON "canonical"."people" ("primary_email");--> statement-breakpoint
CREATE INDEX "raw_batches_projection_idx" ON "ingestor"."raw_batches" ("status","provider","type");--> statement-breakpoint
CREATE INDEX "raw_batches_reconciliation_idx" ON "ingestor"."raw_batches" ("sync_run_id","link_id","type","mode");--> statement-breakpoint
CREATE INDEX "raw_records_projection_idx" ON "ingestor"."raw_records" ("projection_status","provider","type");--> statement-breakpoint
CREATE INDEX "raw_records_pending_projection_idx" ON "ingestor"."raw_records" ("provider","type","created_at") WHERE projection_status = 'pending';--> statement-breakpoint
CREATE INDEX "raw_records_source_lookup_idx" ON "ingestor"."raw_records" ("link_id","type","external_id");--> statement-breakpoint
CREATE INDEX "raw_records_reconciliation_idx" ON "ingestor"."raw_records" ("sync_run_id","link_id","type","external_id");--> statement-breakpoint
CREATE INDEX "raw_records_full_reconcile_idx" ON "ingestor"."raw_records" ("sync_run_id","link_id","type","external_id") WHERE projection_status = 'completed';--> statement-breakpoint
CREATE INDEX "raw_records_projected_cleanup_idx" ON "ingestor"."raw_records" ("projected_at") WHERE projected_at is not null;--> statement-breakpoint
CREATE INDEX "sync_runs_active_lookup_idx" ON "ingestor"."sync_runs" ("link_id","type","status","created_at");--> statement-breakpoint
CREATE INDEX "findings_work_queue_idx" ON "policy"."findings" ("status","severity","last_seen_at");--> statement-breakpoint
CREATE INDEX "findings_resource_idx" ON "policy"."findings" ("resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "findings_policy_idx" ON "policy"."findings" ("policy_id","status");--> statement-breakpoint
CREATE INDEX "findings_scope_idx" ON "policy"."findings" ("site_id","link_id","status");--> statement-breakpoint
CREATE INDEX "policies_provider_idx" ON "policy"."policies" ("provider_id");--> statement-breakpoint
CREATE INDEX "policies_enabled_idx" ON "policy"."policies" ("enabled");--> statement-breakpoint
CREATE INDEX "policy_assignments_policy_idx" ON "policy"."assignments" ("policy_id");--> statement-breakpoint
CREATE INDEX "policy_assignments_policy_set_idx" ON "policy"."assignments" ("policy_set_id");--> statement-breakpoint
CREATE INDEX "policy_assignments_scope_idx" ON "policy"."assignments" ("scope_type","site_id","site_group_id","link_id");--> statement-breakpoint
CREATE INDEX "policy_sets_provider_idx" ON "policy"."policy_sets" ("provider_id");--> statement-breakpoint
CREATE INDEX "article_drafts_updated_idx" ON "wiki"."article_drafts" ("updated_at");--> statement-breakpoint
CREATE INDEX "article_drafts_updated_by_idx" ON "wiki"."article_drafts" ("updated_by");--> statement-breakpoint
CREATE INDEX "article_links_target_idx" ON "wiki"."article_links" ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "article_links_article_idx" ON "wiki"."article_links" ("article_id");--> statement-breakpoint
CREATE INDEX "article_overrides_search_vector_idx" ON "wiki"."article_overrides" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "article_references_target_idx" ON "wiki"."article_references" ("target_article_id");--> statement-breakpoint
CREATE INDEX "article_versions_article_created_idx" ON "wiki"."article_versions" ("article_id","created_at");--> statement-breakpoint
CREATE INDEX "articles_search_vector_idx" ON "wiki"."articles" USING gin ("search_vector");--> statement-breakpoint
CREATE INDEX "edit_locks_expires_idx" ON "wiki"."edit_locks" ("expires_at");--> statement-breakpoint
CREATE INDEX "edit_locks_user_idx" ON "wiki"."edit_locks" ("locked_by");--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_integration_id_integrations_id_fkey" FOREIGN KEY ("integration_id") REFERENCES "integrations"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "integration_links" ADD CONSTRAINT "integration_links_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_id_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "roles"("id");--> statement-breakpoint
ALTER TABLE "site_group_members" ADD CONSTRAINT "site_group_members_site_group_id_site_groups_id_fkey" FOREIGN KEY ("site_group_id") REFERENCES "site_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "site_group_members" ADD CONSTRAINT "site_group_members_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "site_profile_facts" ADD CONSTRAINT "site_profile_facts_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "site_profile_facts" ADD CONSTRAINT "site_profile_facts_field_id_site_profile_options_id_fkey" FOREIGN KEY ("field_id") REFERENCES "site_profile_options"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "site_profile_notes" ADD CONSTRAINT "site_profile_notes_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "site_profile_notes" ADD CONSTRAINT "site_profile_notes_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id");--> statement-breakpoint
ALTER TABLE "site_stack_entries" ADD CONSTRAINT "site_stack_entries_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "site_stack_entries" ADD CONSTRAINT "site_stack_entries_category_id_site_stack_categories_id_fkey" FOREIGN KEY ("category_id") REFERENCES "site_stack_categories"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "site_stack_entries" ADD CONSTRAINT "site_stack_entries_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent"."logs" ADD CONSTRAINT "logs_agent_id_agents_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"."agents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent"."logs" ADD CONSTRAINT "logs_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent"."tickets" ADD CONSTRAINT "tickets_agent_id_agents_id_fkey" FOREIGN KEY ("agent_id") REFERENCES "agent"."agents"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent"."tickets" ADD CONSTRAINT "tickets_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "agent"."agents" ADD CONSTRAINT "agents_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "audit"."customer_logs" ADD CONSTRAINT "customer_logs_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "billing"."psa_items" ADD CONSTRAINT "psa_items_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing"."psa_items" ADD CONSTRAINT "psa_items_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_results" ADD CONSTRAINT "reconciliation_results_run_id_reconciliation_runs_id_fkey" FOREIGN KEY ("run_id") REFERENCES "billing"."reconciliation_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_results" ADD CONSTRAINT "reconciliation_results_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_results" ADD CONSTRAINT "reconciliation_results_psa_item_id_psa_items_id_fkey" FOREIGN KEY ("psa_item_id") REFERENCES "billing"."psa_items"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_results" ADD CONSTRAINT "reconciliation_results_rule_id_reconciliation_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "billing"."reconciliation_rules"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_rule_scopes" ADD CONSTRAINT "reconciliation_rule_scopes_rule_id_reconciliation_rules_id_fkey" FOREIGN KEY ("rule_id") REFERENCES "billing"."reconciliation_rules"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_rule_scopes" ADD CONSTRAINT "reconciliation_rule_scopes_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_rule_scopes" ADD CONSTRAINT "reconciliation_rule_scopes_site_group_id_site_groups_id_fkey" FOREIGN KEY ("site_group_id") REFERENCES "site_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "billing"."reconciliation_rules" ADD CONSTRAINT "reconciliation_rules_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canonical"."assets" ADD CONSTRAINT "assets_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "canonical"."entity_sources" ADD CONSTRAINT "entity_sources_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "canonical"."people" ADD CONSTRAINT "people_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ingestor"."raw_batches" ADD CONSTRAINT "raw_batches_sync_run_id_sync_runs_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ingestor"."sync_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingestor"."raw_batches" ADD CONSTRAINT "raw_batches_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingestor"."raw_batches" ADD CONSTRAINT "raw_batches_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ingestor"."raw_records" ADD CONSTRAINT "raw_records_raw_batch_id_raw_batches_id_fkey" FOREIGN KEY ("raw_batch_id") REFERENCES "ingestor"."raw_batches"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingestor"."raw_records" ADD CONSTRAINT "raw_records_sync_run_id_sync_runs_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ingestor"."sync_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingestor"."raw_records" ADD CONSTRAINT "raw_records_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingestor"."raw_records" ADD CONSTRAINT "raw_records_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "ingestor"."sync_context" ADD CONSTRAINT "sync_context_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingestor"."sync_run_stages" ADD CONSTRAINT "sync_run_stages_sync_run_id_sync_runs_id_fkey" FOREIGN KEY ("sync_run_id") REFERENCES "ingestor"."sync_runs"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "ingestor"."sync_runs" ADD CONSTRAINT "sync_runs_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."findings" ADD CONSTRAINT "findings_policy_id_policies_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policy"."policies"("id");--> statement-breakpoint
ALTER TABLE "policy"."findings" ADD CONSTRAINT "findings_policy_set_id_policy_sets_id_fkey" FOREIGN KEY ("policy_set_id") REFERENCES "policy"."policy_sets"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "policy"."findings" ADD CONSTRAINT "findings_policy_assignment_id_assignments_id_fkey" FOREIGN KEY ("policy_assignment_id") REFERENCES "policy"."assignments"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "policy"."findings" ADD CONSTRAINT "findings_provider_id_integrations_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "integrations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "policy"."findings" ADD CONSTRAINT "findings_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."findings" ADD CONSTRAINT "findings_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "policy"."policies" ADD CONSTRAINT "policies_provider_id_integrations_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "integrations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "policy"."assignments" ADD CONSTRAINT "assignments_policy_id_policies_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policy"."policies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."assignments" ADD CONSTRAINT "assignments_policy_set_id_policy_sets_id_fkey" FOREIGN KEY ("policy_set_id") REFERENCES "policy"."policy_sets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."assignments" ADD CONSTRAINT "assignments_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."assignments" ADD CONSTRAINT "assignments_site_group_id_site_groups_id_fkey" FOREIGN KEY ("site_group_id") REFERENCES "site_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."assignments" ADD CONSTRAINT "assignments_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."policy_set_items" ADD CONSTRAINT "policy_set_items_policy_set_id_policy_sets_id_fkey" FOREIGN KEY ("policy_set_id") REFERENCES "policy"."policy_sets"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."policy_set_items" ADD CONSTRAINT "policy_set_items_policy_id_policies_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "policy"."policies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "policy"."policy_sets" ADD CONSTRAINT "policy_sets_provider_id_integrations_id_fkey" FOREIGN KEY ("provider_id") REFERENCES "integrations"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "vendors"."m365_devices" ADD CONSTRAINT "m365_devices_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_domain_config" ADD CONSTRAINT "m365_domain_config_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_exchange_configs" ADD CONSTRAINT "m365_exchange_configs_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_groups" ADD CONSTRAINT "m365_groups_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_identities" ADD CONSTRAINT "m365_identities_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_identities" ADD CONSTRAINT "m365_identities_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."m365_identity_groups" ADD CONSTRAINT "m365_identity_groups_identity_id_m365_identities_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "vendors"."m365_identities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_identity_groups" ADD CONSTRAINT "m365_identity_groups_group_id_m365_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "vendors"."m365_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_identity_groups" ADD CONSTRAINT "m365_identity_groups_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_identity_roles" ADD CONSTRAINT "m365_identity_roles_identity_id_m365_identities_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "vendors"."m365_identities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_identity_roles" ADD CONSTRAINT "m365_identity_roles_role_id_m365_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "vendors"."m365_roles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_identity_roles" ADD CONSTRAINT "m365_identity_roles_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_inbox_rules" ADD CONSTRAINT "m365_inbox_rules_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_licenses" ADD CONSTRAINT "m365_licenses_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_mailbox_forwarding" ADD CONSTRAINT "m365_mailbox_forwarding_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_oauth_grants" ADD CONSTRAINT "m365_oauth_grants_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_policies" ADD CONSTRAINT "m365_policies_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_groups" ADD CONSTRAINT "m365_policy_groups_policy_id_m365_policies_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "vendors"."m365_policies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_groups" ADD CONSTRAINT "m365_policy_groups_group_id_m365_groups_id_fkey" FOREIGN KEY ("group_id") REFERENCES "vendors"."m365_groups"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_identities" ADD CONSTRAINT "m365_policy_identities_policy_id_m365_policies_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "vendors"."m365_policies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_identities" ADD CONSTRAINT "m365_policy_identities_identity_id_m365_identities_id_fkey" FOREIGN KEY ("identity_id") REFERENCES "vendors"."m365_identities"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_roles" ADD CONSTRAINT "m365_policy_roles_policy_id_m365_policies_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "vendors"."m365_policies"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_policy_roles" ADD CONSTRAINT "m365_policy_roles_role_id_m365_roles_id_fkey" FOREIGN KEY ("role_id") REFERENCES "vendors"."m365_roles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_risky_users" ADD CONSTRAINT "m365_risky_users_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."m365_teams_config" ADD CONSTRAINT "m365_teams_config_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoints" ADD CONSTRAINT "sophos_endpoints_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."sophos_endpoints" ADD CONSTRAINT "sophos_endpoints_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."sophos_firewalls" ADD CONSTRAINT "sophos_firewalls_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."sophos_firewalls" ADD CONSTRAINT "sophos_firewalls_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."sophos_licenses" ADD CONSTRAINT "sophos_licenses_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."sophos_licenses" ADD CONSTRAINT "sophos_licenses_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."sophos_tamper_protection" ADD CONSTRAINT "sophos_tamper_protection_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."sophos_tamper_protection" ADD CONSTRAINT "sophos_tamper_protection_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."sophos_tamper_protection" ADD CONSTRAINT "sophos_tamper_protection_endpoint_id_sophos_endpoints_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "vendors"."sophos_endpoints"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."datto_endpoints" ADD CONSTRAINT "datto_endpoints_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."datto_endpoints" ADD CONSTRAINT "datto_endpoints_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."cove_endpoints" ADD CONSTRAINT "cove_endpoints_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."cove_endpoints" ADD CONSTRAINT "cove_endpoints_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "vendors"."halopsa_recurring_items" ADD CONSTRAINT "halopsa_recurring_items_link_id_integration_links_id_fkey" FOREIGN KEY ("link_id") REFERENCES "integration_links"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "vendors"."halopsa_recurring_items" ADD CONSTRAINT "halopsa_recurring_items_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id");--> statement-breakpoint
ALTER TABLE "wiki"."article_contexts" ADD CONSTRAINT "article_contexts_article_id_articles_id_fkey" FOREIGN KEY ("article_id") REFERENCES "wiki"."articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_contexts" ADD CONSTRAINT "article_contexts_context_id_contexts_id_fkey" FOREIGN KEY ("context_id") REFERENCES "wiki"."contexts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_drafts" ADD CONSTRAINT "article_drafts_article_id_articles_id_fkey" FOREIGN KEY ("article_id") REFERENCES "wiki"."articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_drafts" ADD CONSTRAINT "article_drafts_base_version_id_article_versions_id_fkey" FOREIGN KEY ("base_version_id") REFERENCES "wiki"."article_versions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."article_drafts" ADD CONSTRAINT "article_drafts_primary_context_id_contexts_id_fkey" FOREIGN KEY ("primary_context_id") REFERENCES "wiki"."contexts"("id");--> statement-breakpoint
ALTER TABLE "wiki"."article_drafts" ADD CONSTRAINT "article_drafts_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."article_drafts" ADD CONSTRAINT "article_drafts_updated_by_users_id_fkey" FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."article_links" ADD CONSTRAINT "article_links_article_id_articles_id_fkey" FOREIGN KEY ("article_id") REFERENCES "wiki"."articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_links" ADD CONSTRAINT "article_links_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."article_overrides" ADD CONSTRAINT "article_overrides_article_id_articles_id_fkey" FOREIGN KEY ("article_id") REFERENCES "wiki"."articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_overrides" ADD CONSTRAINT "article_overrides_site_id_sites_id_fkey" FOREIGN KEY ("site_id") REFERENCES "sites"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_overrides" ADD CONSTRAINT "article_overrides_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."article_references" ADD CONSTRAINT "article_references_source_article_id_articles_id_fkey" FOREIGN KEY ("source_article_id") REFERENCES "wiki"."articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_references" ADD CONSTRAINT "article_references_target_article_id_articles_id_fkey" FOREIGN KEY ("target_article_id") REFERENCES "wiki"."articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_references" ADD CONSTRAINT "article_references_source_version_id_article_versions_id_fkey" FOREIGN KEY ("source_version_id") REFERENCES "wiki"."article_versions"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."article_tags" ADD CONSTRAINT "article_tags_article_id_articles_id_fkey" FOREIGN KEY ("article_id") REFERENCES "wiki"."articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_tags" ADD CONSTRAINT "article_tags_tag_id_tags_id_fkey" FOREIGN KEY ("tag_id") REFERENCES "wiki"."tags"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_versions" ADD CONSTRAINT "article_versions_article_id_articles_id_fkey" FOREIGN KEY ("article_id") REFERENCES "wiki"."articles"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."article_versions" ADD CONSTRAINT "article_versions_primary_context_id_contexts_id_fkey" FOREIGN KEY ("primary_context_id") REFERENCES "wiki"."contexts"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."article_versions" ADD CONSTRAINT "article_versions_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."articles" ADD CONSTRAINT "articles_primary_context_id_contexts_id_fkey" FOREIGN KEY ("primary_context_id") REFERENCES "wiki"."contexts"("id");--> statement-breakpoint
ALTER TABLE "wiki"."articles" ADD CONSTRAINT "articles_created_by_users_id_fkey" FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "wiki"."contexts" ADD CONSTRAINT "contexts_parent_id_contexts_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "wiki"."contexts"("id") ON DELETE CASCADE;--> statement-breakpoint
ALTER TABLE "wiki"."edit_locks" ADD CONSTRAINT "edit_locks_locked_by_users_id_fkey" FOREIGN KEY ("locked_by") REFERENCES "users"("id") ON DELETE CASCADE;--> statement-breakpoint
CREATE VIEW "sites_with_counts" WITH (security_invoker = true) AS (
    select
      s.id,
      s.name,
      s.description,
      coalesce(a.asset_count, 0)::int as asset_count,
      coalesce(p.people_count, 0)::int as people_count,
      coalesce(f.open_finding_count, 0)::int as open_finding_count,
      100::int as framework_score,
      100::int as policy_health,
      coalesce(src.sources, array[]::text[]) as sources,
      coalesce(array_to_string(src.sources, ', '), '') as source_list,
      s.created_at,
      s.updated_at
    from public.sites s
    left join lateral (
      select count(*)::int as asset_count
      from canonical.assets a
      where a.site_id = s.id
    ) a on true
    left join lateral (
      select count(*)::int as people_count
      from canonical.people p
      where p.site_id = s.id
    ) p on true
    left join lateral (
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.site_id = s.id
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
    left join lateral (
      select array_agg(distinct il.integration_id order by il.integration_id) as sources
      from public.integration_links il
      where il.site_id = s.id
        and il.status = 'active'
    ) src on true
  );--> statement-breakpoint
CREATE VIEW "canonical"."assets_with_sites" WITH (security_invoker = true) AS (
    select
      a.id,
      a.site_id,
      coalesce(s.name, 'Unassigned') as site_name,
      a.display_name,
      a.hostname,
      a.serial_number,
      a.os,
      a.asset_type,
      a.status,
      a.source_confidence,
      coalesce(src.sources, array[]::text[]) as sources,
      coalesce(array_to_string(src.sources, ', '), '') as source_list,
      coalesce(f.open_finding_count, 0)::int as open_finding_count,
      a.created_at,
      a.updated_at
    from canonical.assets a
    left join public.sites s on s.id = a.site_id
    left join lateral (
      select array_agg(distinct es.provider order by es.provider) as sources
      from canonical.entity_sources es
      where es.canonical_type = 'asset'
        and es.canonical_id = a.id
        and es.status = 'confirmed'
    ) src on true
    left join lateral (
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.resource_type = 'asset'
        and pf.resource_id = a.id::text
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
  );--> statement-breakpoint
CREATE VIEW "canonical"."people_with_sites" WITH (security_invoker = true) AS (
    select
      p.id,
      p.site_id,
      coalesce(s.name, 'Unassigned') as site_name,
      p.primary_email,
      p.display_name,
      p.status,
      p.source_confidence,
      coalesce(src.sources, array[]::text[]) as sources,
      coalesce(array_to_string(src.sources, ', '), '') as source_list,
      coalesce(f.open_finding_count, 0)::int as open_finding_count,
      p.created_at,
      p.updated_at
    from canonical.people p
    left join public.sites s on s.id = p.site_id
    left join lateral (
      select array_agg(distinct es.provider order by es.provider) as sources
      from canonical.entity_sources es
      where es.canonical_type = 'person'
        and es.canonical_id = p.id
        and es.status = 'confirmed'
    ) src on true
    left join lateral (
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.resource_type = 'person'
        and pf.resource_id = p.id::text
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
  );--> statement-breakpoint
CREATE VIEW "policy"."findings_with_context" WITH (security_invoker = true) AS (
    select
      f.id,
      f.policy_id,
      p.name as policy_name,
      f.provider_id,
      f.link_id,
      f.site_id,
      coalesce(l.name, '-') as link_name,
      coalesce(s.name, '-') as site_name,
      f.resource_type,
      f.resource_table,
      f.resource_id,
      coalesce(a.display_name, pe.display_name, f.resource_external_id, f.resource_id) as resource_name,
      f.resource_external_id,
      f.fingerprint,
      f.title,
      f.summary,
      f.severity,
      f.status,
      coalesce(f.summary, f.evidence->>'summary', 'Structured evidence is available on the finding.') as evidence_summary,
      f.recommendation,
      f.suppressed_until,
      f.suppressed_at,
      f.suppression_reason,
      f.suppressed_by,
      f.first_seen_at,
      f.last_seen_at
    from policy.findings f
    inner join policy.policies p on p.id = f.policy_id
    left join public.sites s on s.id = f.site_id
    left join public.integration_links l on l.id = f.link_id
    left join canonical.assets a on f.resource_type = 'asset' and f.resource_id = a.id::text
    left join canonical.people pe on f.resource_type = 'person' and f.resource_id = pe.id::text
  );--> statement-breakpoint
CREATE VIEW "policy"."policies_with_stats" WITH (security_invoker = true) AS (
    select
      p.id,
      p.source,
      p.name,
      p.description,
      p.category,
      p.provider_id,
      p.target_type,
      p.target_type as scope,
      p.severity,
      p.enabled,
      p.recommendation,
      coalesce(fr.framework_list, '') as framework_list,
      coalesce(f.open_finding_count, 0)::int as open_finding_count,
      p.updated_at
    from policy.policies p
    left join lateral (
      select string_agg(distinct ps.name, ', ' order by ps.name) as framework_list
      from policy.policy_set_items psi
      inner join policy.policy_sets ps on ps.id = psi.policy_set_id
      where psi.policy_id = p.id
    ) fr on true
    left join lateral (
      select count(*)::int as open_finding_count
      from policy.findings pf
      where pf.policy_id = p.id
        and pf.status in ('open', 'acknowledged', 'regressed')
    ) f on true
  );--> statement-breakpoint
CREATE VIEW "policy"."policy_sets_with_stats" WITH (security_invoker = true) AS (
    select
      ps.id,
      ps.name,
      ps.description,
      ps.category,
      ps.provider_id,
      ps.enabled,
      coalesce(pc.policy_count, 0)::int as policy_count,
      coalesce(of.open_findings, 0)::int as open_findings,
      case
        when coalesce(pc.policy_count, 0) = 0 then 100
        else greatest(0, least(100, round(100 - (coalesce(of.open_findings, 0)::numeric / pc.policy_count::numeric * 10))::int))
      end as pass_rate,
      ps.updated_at
    from policy.policy_sets ps
    left join lateral (
      select count(*)::int as policy_count
      from policy.policy_set_items psi
      where psi.policy_set_id = ps.id
    ) pc on true
    left join lateral (
      select count(distinct f.id)::int as open_findings
      from policy.policy_set_items psi
      inner join policy.findings f on f.policy_id = psi.policy_id
      where psi.policy_set_id = ps.id
        and f.status in ('open', 'acknowledged', 'regressed')
    ) of on true
  );--> statement-breakpoint
CREATE VIEW "vendors"."sophos_endpoints_with_site" WITH (security_invoker = true) AS (
    select
      e.id,
      e.link_id,
      e.site_id,
      coalesce(s.name, l.name, l.external_id, l.id::text) as site_name,
      e.external_id,
      e.hostname,
      e.type,
      e.platform,
      e.os_name,
      e.health,
      e.online,
      e.needs_upgrade,
      e.has_mdr,
      e.tamper_protection_enabled,
      e.lockdown,
      e.last_heartbeat_at,
      e.last_seen_at,
      e.created_at,
      e.updated_at
    from vendors.sophos_endpoints e
    inner join public.integration_links l on l.id = e.link_id
    left join public.sites s on s.id = coalesce(e.site_id, l.site_id)
  );--> statement-breakpoint
CREATE VIEW "vendors"."sophos_firewalls_with_site" WITH (security_invoker = true) AS (
    select
      f.id,
      f.link_id,
      f.site_id,
      coalesce(s.name, l.name, l.external_id, l.id::text) as site_name,
      f.external_id,
      f.name,
      f.hostname,
      f.model,
      f.serial_number,
      f.firmware_version,
      f.external_ip,
      f.connected,
      f.suspended,
      f.managing,
      f.reporting,
      f.upgrade_to_version,
      f.last_change_at,
      f.last_seen_at,
      f.created_at,
      f.updated_at
    from vendors.sophos_firewalls f
    inner join public.integration_links l on l.id = f.link_id
    left join public.sites s on s.id = coalesce(f.site_id, l.site_id)
  );--> statement-breakpoint
CREATE VIEW "vendors"."sophos_licenses_with_site" WITH (security_invoker = true) AS (
    select
      li.id,
      li.link_id,
      li.site_id,
      coalesce(s.name, l.name, l.external_id, l.id::text) as site_name,
      li.external_id,
      li.license_id,
      li.code,
      li.name,
      li.type,
      li.perpetual,
      li.unlimited,
      li.quantity,
      li.usage_count,
      li.started_at,
      li.ends_at,
      li.last_seen_at,
      li.created_at,
      li.updated_at
    from vendors.sophos_licenses li
    inner join public.integration_links l on l.id = li.link_id
    left join public.sites s on s.id = coalesce(li.site_id, l.site_id)
  );--> statement-breakpoint
CREATE VIEW "vendors"."cove_endpoints_with_site" WITH (security_invoker = true) AS (
    select
      e.id,
      e.link_id,
      e.site_id,
      coalesce(s.name, l.name, l.external_id, l.id::text) as site_name,
      e.external_id,
      e.endpoint_name,
      e.hostname,
      e.type,
      e.profile,
      e.retention_policy,
      e.status,
      e.lsv_status,
      e.errors,
      e.selected_size,
      e.used_storage,
      e.last_28_days,
      e.last_success_at,
      e.last_seen_at,
      e.created_at,
      e.updated_at
    from vendors.cove_endpoints e
    inner join public.integration_links l on l.id = e.link_id
    left join public.sites s on s.id = coalesce(e.site_id, l.site_id)
  );--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "integration_links" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "integration_links" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "integration_links" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "integration_links" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "integrations" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "integrations" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "integrations" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "integrations" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "roles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "roles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "roles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "roles" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "users" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "users" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "users" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "users" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "site_group_members" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "site_group_members" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "site_group_members" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "site_group_members" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "site_groups" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "site_groups" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "site_groups" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "site_groups" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "sites" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "sites" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "sites" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "sites" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "site_profile_facts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "site_profile_facts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "site_profile_facts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "site_profile_facts" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "site_profile_options" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "site_profile_options" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "site_profile_options" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "site_profile_options" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "site_profile_notes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "site_profile_notes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "site_profile_notes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "site_profile_notes" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "site_stack_entries" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "site_stack_entries" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "site_stack_entries" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "site_stack_entries" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "agent"."logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "agent"."logs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "agent"."logs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "agent"."logs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "agent"."tickets" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "agent"."tickets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "agent"."tickets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "agent"."tickets" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "agent"."agents" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "agent"."agents" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "agent"."agents" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "agent"."agents" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "audit"."customer_logs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "audit"."customer_logs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "audit"."customer_logs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "audit"."customer_logs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "billing"."psa_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "billing"."psa_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "billing"."psa_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "billing"."psa_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "billing"."reconciliation_results" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "billing"."reconciliation_results" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "billing"."reconciliation_results" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "billing"."reconciliation_results" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "billing"."reconciliation_rule_scopes" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "billing"."reconciliation_rule_scopes" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "billing"."reconciliation_rule_scopes" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "billing"."reconciliation_rule_scopes" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "billing"."reconciliation_rules" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "billing"."reconciliation_rules" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "billing"."reconciliation_rules" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "billing"."reconciliation_rules" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "billing"."reconciliation_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "billing"."reconciliation_runs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "billing"."reconciliation_runs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "billing"."reconciliation_runs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "canonical"."assets" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "canonical"."assets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "canonical"."assets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "canonical"."assets" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "canonical"."entity_sources" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "canonical"."entity_sources" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "canonical"."entity_sources" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "canonical"."entity_sources" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "canonical"."people" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "canonical"."people" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "canonical"."people" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "canonical"."people" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "ingestor"."raw_batches" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "ingestor"."raw_batches" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "ingestor"."raw_batches" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "ingestor"."raw_batches" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "ingestor"."raw_records" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "ingestor"."raw_records" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "ingestor"."raw_records" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "ingestor"."raw_records" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "ingestor"."sync_context" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "ingestor"."sync_context" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "ingestor"."sync_context" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "ingestor"."sync_context" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "ingestor"."sync_run_stages" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "ingestor"."sync_run_stages" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "ingestor"."sync_run_stages" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "ingestor"."sync_run_stages" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "ingestor"."sync_runs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "ingestor"."sync_runs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "ingestor"."sync_runs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "ingestor"."sync_runs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "policy"."findings" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "policy"."findings" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "policy"."findings" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "policy"."findings" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "policy"."policies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "policy"."policies" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "policy"."policies" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "policy"."policies" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "policy"."assignments" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "policy"."assignments" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "policy"."assignments" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "policy"."assignments" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "policy"."policy_set_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "policy"."policy_set_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "policy"."policy_set_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "policy"."policy_set_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "policy"."policy_sets" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "policy"."policy_sets" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "policy"."policy_sets" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (true) WITH CHECK (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "policy"."policy_sets" AS PERMISSIVE FOR DELETE TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_devices" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_devices" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_devices" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_devices" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_domain_config" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_domain_config" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_domain_config" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_domain_config" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_exchange_configs" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_exchange_configs" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_exchange_configs" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_exchange_configs" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_groups" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_groups" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_groups" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_groups" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_identities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_identities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_identities" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_identities" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_identity_groups" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_identity_groups" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_identity_groups" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_identity_groups" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_identity_roles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_identity_roles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_identity_roles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_identity_roles" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_inbox_rules" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_inbox_rules" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_inbox_rules" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_inbox_rules" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_licenses" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_licenses" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_licenses" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_licenses" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_mailbox_forwarding" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_mailbox_forwarding" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_mailbox_forwarding" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_mailbox_forwarding" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_oauth_grants" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_oauth_grants" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_oauth_grants" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_oauth_grants" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_policies" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_policies" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_policies" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_policies" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_policy_groups" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_policy_groups" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_policy_groups" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_policy_groups" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_policy_identities" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_policy_identities" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_policy_identities" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_policy_identities" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_policy_roles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_policy_roles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_policy_roles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_policy_roles" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_risky_users" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_risky_users" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_risky_users" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_risky_users" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_roles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_roles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_roles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_roles" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."m365_teams_config" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."m365_teams_config" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."m365_teams_config" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."m365_teams_config" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."sophos_endpoints" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."sophos_endpoints" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."sophos_endpoints" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."sophos_endpoints" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."sophos_firewalls" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."sophos_firewalls" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."sophos_firewalls" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."sophos_firewalls" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."sophos_licenses" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."sophos_licenses" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."sophos_licenses" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."sophos_licenses" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."sophos_tamper_protection" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."sophos_tamper_protection" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."sophos_tamper_protection" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."sophos_tamper_protection" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."datto_endpoints" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."datto_endpoints" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."datto_endpoints" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."datto_endpoints" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."cove_endpoints" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."cove_endpoints" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."cove_endpoints" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."cove_endpoints" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "vendors"."halopsa_recurring_items" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "vendors"."halopsa_recurring_items" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "vendors"."halopsa_recurring_items" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "vendors"."halopsa_recurring_items" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."article_drafts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."article_drafts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."article_drafts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."article_drafts" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."article_links" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."article_links" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."article_links" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."article_links" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."article_overrides" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."article_overrides" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."article_overrides" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."article_overrides" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."article_references" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."article_references" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."article_references" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."article_references" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."article_tags" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."article_tags" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."article_tags" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."article_tags" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."article_versions" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."article_versions" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."article_versions" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."article_versions" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."articles" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."articles" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."articles" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."articles" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."contexts" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."contexts" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."contexts" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."contexts" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."edit_locks" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."edit_locks" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."edit_locks" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."edit_locks" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-select" ON "wiki"."tags" AS PERMISSIVE FOR SELECT TO "authenticated" USING (true);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-insert" ON "wiki"."tags" AS PERMISSIVE FOR INSERT TO "authenticated" WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-update" ON "wiki"."tags" AS PERMISSIVE FOR UPDATE TO "authenticated" USING (false) WITH CHECK (false);--> statement-breakpoint
CREATE POLICY "crud-authenticated-policy-delete" ON "wiki"."tags" AS PERMISSIVE FOR DELETE TO "authenticated" USING (false);