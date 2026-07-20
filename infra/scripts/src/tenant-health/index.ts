import { eq } from "drizzle-orm";
import {
  getCatalogDb,
  getTenantServiceDbByOrgId,
  organization,
} from "@mspbyte/drizzle-catalog";
import { env, requireEncryptionKey } from "../env.js";
import { checkDeadLetter } from "./dead-letter.js";
import { checkLinkMeta } from "./link-meta.js";

export type HealthReport = {
  check: string;
  status: "ok" | "issues" | "fixed" | "error";
  details: string;
  metrics?: Record<string, number>;
};

export type HealthCheckContext = {
  orgId: string;
  tenantDb: unknown;
  fix: boolean;
};

export type HealthCheck = {
  name: string;
  run: (ctx: HealthCheckContext) => Promise<HealthReport>;
};

const ALL_CHECKS: HealthCheck[] = [
  { name: "link-meta", run: checkLinkMeta },
  { name: "dead-letter", run: checkDeadLetter },
];

export type RunTenantHealthOptions = {
  orgId?: string;
  all: boolean;
  fix: boolean;
  only?: string;
};

export async function runTenantHealth(opts: RunTenantHealthOptions): Promise<void> {
  const catalog = getCatalogDb(env.CATALOG_DATABASE_URL);

  const orgs: Array<{ id: string; name: string }> = opts.orgId
    ? [{ id: opts.orgId, name: opts.orgId }]
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

  const only = opts.only?.split(",").map((s) => s.trim()).filter(Boolean);
  const checks = only ? ALL_CHECKS.filter((c) => only.includes(c.name)) : ALL_CHECKS;

  if (checks.length === 0) {
    console.error(
      `No checks matched --only=${opts.only}. Available: ${ALL_CHECKS.map((c) => c.name).join(", ")}`,
    );
    process.exit(1);
  }

  const encryptionKey = requireEncryptionKey();
  let orgsWithIssues = 0;

  for (const org of orgs) {
    console.log(`\n=== Org ${org.name} (${org.id}) ===`);
    let tenant: Awaited<ReturnType<typeof getTenantServiceDbByOrgId>>;
    try {
      tenant = await getTenantServiceDbByOrgId(org.id, encryptionKey, env.CATALOG_DATABASE_URL);
    } catch (error) {
      console.log(
        `  [error] failed to open tenant DB: ${error instanceof Error ? error.message : String(error)}`,
      );
      orgsWithIssues++;
      continue;
    }

    let orgHasIssues = false;
    for (const check of checks) {
      try {
        const report = await check.run({
          orgId: org.id,
          tenantDb: tenant.db,
          fix: opts.fix,
        });
        console.log(`  [${report.status}] ${report.check}: ${report.details}`);
        if (report.status === "issues" || report.status === "error") {
          orgHasIssues = true;
        }
      } catch (error) {
        console.log(
          `  [error] ${check.name}: ${error instanceof Error ? error.message : String(error)}`,
        );
        orgHasIssues = true;
      }
    }
    if (orgHasIssues) orgsWithIssues++;
  }

  console.log(
    `\nDone. ${orgs.length - orgsWithIssues}/${orgs.length} orgs clean${opts.fix ? "" : " (dry-run — re-run with --fix to apply)"}.`,
  );

  if (orgsWithIssues > 0 && !opts.fix) {
    process.exit(2);
  }
}
