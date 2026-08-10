ALTER TABLE "packages"."packages" ADD COLUMN "allowed_sites" jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "packages"."packages" ADD COLUMN "allowed_site_groups" jsonb NOT NULL DEFAULT '[]'::jsonb;
