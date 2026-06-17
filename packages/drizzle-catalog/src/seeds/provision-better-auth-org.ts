import "dotenv/config";
import postgres from "postgres";

const required = (name: string) => {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
};

const catalogUrl = required("CATALOG_DATABASE_URL");
const tenantUrl = required("TENANT_SERVICE_DATABASE_URL");

const authOrgId = required("AUTH_ORG_ID");
const authUserId = required("AUTH_USER_ID");
const orgName = required("ORG_NAME");
const orgSlug = required("ORG_SLUG");
const userEmail = required("USER_EMAIL");
const userName = process.env.USER_NAME ?? userEmail;
const roleName = process.env.USER_ROLE_NAME ?? "Owner";

const catalog = postgres(catalogUrl);
const tenant = postgres(tenantUrl);

try {
  await catalog.begin(async (sql) => {
    await sql`
      insert into "organization" ("id", "name", "slug", "neon_project_id", "service_connection_string", "status", "created_at")
      values (${authOrgId}, ${orgName}, ${orgSlug}, ${required("NEON_PROJECT_ID")}, ${required("NEON_CONNECTION_STRING")}, 'active', now())
      on conflict ("id") do update set
        "name" = excluded."name",
        "slug" = excluded."slug",
        "neon_project_id" = excluded."neon_project_id",
        "service_connection_string" = excluded."service_connection_string",
        "status" = 'active'
    `;

    await sql`
      insert into "user" ("id", "name", "email", "email_verified", "created_at", "updated_at")
      values (${authUserId}, ${userName}, ${userEmail}, true, now(), now())
      on conflict ("id") do update set
        "name" = excluded."name",
        "email" = excluded."email",
        "email_verified" = true,
        "updated_at" = now()
    `;

    await sql`
      insert into "member" ("id", "organization_id", "user_id", "role", "created_at")
      values (${crypto.randomUUID()}, ${authOrgId}, ${authUserId}, 'owner', now())
      on conflict ("user_id", "organization_id") do update set "role" = 'owner'
    `;
  });

  const [role] = await tenant`
    insert into "roles" ("name", "description", "level", "attributes", "created_at", "updated_at")
    values (${roleName}, 'Provisioned owner role', 100, ${JSON.stringify({ "*": true })}::jsonb, now(), now())
    on conflict ("name") do update set
      "description" = excluded."description",
      "level" = excluded."level",
      "attributes" = excluded."attributes",
      "updated_at" = now()
    returning "id"
  `;

  await tenant`
    insert into "users" ("auth_user_id", "email", "name", "role_id", "created_at", "updated_at")
    values (${authUserId}, ${userEmail}, ${userName}, ${role?.id}, now(), now())
    on conflict ("auth_user_id") do update set
      "email" = excluded."email",
      "name" = excluded."name",
      "role_id" = excluded."role_id",
      "updated_at" = now()
  `;

  console.log(`Provisioned ${orgName} for ${userEmail}`);
} finally {
  await Promise.all([catalog.end(), tenant.end()]);
}
