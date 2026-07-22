import { eq } from "drizzle-orm";
import {
  getCatalogDb,
  getTenantServiceDbByOrgId,
  organization,
} from "@mspbyte/drizzle-catalog";
import { env, requireEncryptionKey } from "../env.js";
import { seedSystemRoles } from "./system-roles.js";

export type SeedReport = {
  seed: string;
  status: "applied" | "unchanged" | "error";
  details: string;
  metrics?: Record<string, number>;
};

export type SeedContext = {
  orgId: string;
  tenantDb: unknown;
};

export type Seed = {
  name: string;
  run: (ctx: SeedContext) => Promise<SeedReport>;
};

const ALL_SEEDS: Seed[] = [{ name: "system-roles", run: seedSystemRoles }];

export type RunTenantSeedOptions = {
  orgId?: string;
  all: boolean;
  only?: string;
};

export async function runTenantSeed(opts: RunTenantSeedOptions): Promise<void> {
  if (!env.CATALOG_DATABASE_URL) {
    throw new Error("CATALOG_DATABASE_URL is not set");
  }

  const catalog = getCatalogDb(env.CATALOG_DATABASE_URL);

  const orgs: Array<{ id: string; name: string }> = opts.orgId
    ? await catalog
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(eq(organization.id, opts.orgId))
    : opts.all
      ? await catalog
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(eq(organization.status, "active"))
      : [];

  if (orgs.length === 0) {
    console.error("Provide --org=<uuid> or --all");
    process.exit(1);
  }

  const only = opts.only
    ?.split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const seeds = only ? ALL_SEEDS.filter((s) => only.includes(s.name)) : ALL_SEEDS;

  if (seeds.length === 0) {
    console.error(
      `No seeds matched --only=${opts.only}. Available: ${ALL_SEEDS.map((s) => s.name).join(", ")}`,
    );
    process.exit(1);
  }

  const encryptionKey = requireEncryptionKey();
  let failed = 0;

  for (const org of orgs) {
    console.log(`\n=== Org ${org.name} (${org.id}) ===`);
    let tenant: Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>;
    try {
      tenant = await getTenantServiceDbByOrgId(
        org.id,
        encryptionKey,
        env.CATALOG_DATABASE_URL,
      );
    } catch (error) {
      console.log(
        `  [error] failed to open tenant DB: ${error instanceof Error ? error.message : String(error)}`,
      );
      failed++;
      continue;
    }

    let orgHadError = false;
    for (const seed of seeds) {
      try {
        const report = await seed.run({ orgId: org.id, tenantDb: tenant.db });
        console.log(`  [${report.status}] ${report.seed}: ${report.details}`);
        if (report.status === "error") orgHadError = true;
      } catch (error) {
        console.log(
          `  [error] ${seed.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        orgHadError = true;
      }
    }
    if (orgHadError) failed++;
  }

  console.log(
    `\nDone. ${orgs.length - failed}/${orgs.length} orgs seeded cleanly.`,
  );
  if (failed > 0) process.exit(2);
}
