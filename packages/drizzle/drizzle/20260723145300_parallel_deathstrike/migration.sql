ALTER TABLE "users" DROP CONSTRAINT "users_role_id_roles_id_fkey";--> statement-breakpoint
ALTER TABLE "roles" DROP COLUMN "attributes";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "role_id";