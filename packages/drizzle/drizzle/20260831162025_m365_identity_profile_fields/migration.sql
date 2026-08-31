ALTER TABLE "vendors"."m365_identities"
  ADD COLUMN "primary_email" text,
  ADD COLUMN "job_title" text,
  ADD COLUMN "department" text,
  ADD COLUMN "company_name" text,
  ADD COLUMN "employee_id" text,
  ADD COLUMN "office_location" text,
  ADD COLUMN "usage_location" text,
  ADD COLUMN "business_phone" text,
  ADD COLUMN "mobile_phone" text,
  ADD COLUMN "directory_created_at" timestamp with time zone,
  ADD COLUMN "on_premises_sync_enabled" boolean;
