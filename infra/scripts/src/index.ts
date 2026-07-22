import { parseArgs } from "./args.js";
import { runTenantHealth } from "./tenant-health/index.js";
import { runTenantMigrate } from "./tenant-migrate/index.js";
import { runTenantSeed } from "./tenant-seed/index.js";

const COMMANDS: Record<string, (args: ReturnType<typeof parseArgs>) => Promise<void>> = {
  "tenant-health": async (args) => {
    await runTenantHealth({
      orgId: typeof args.flags.org === "string" ? args.flags.org : undefined,
      all: args.flags.all === true,
      fix: args.flags.fix === true,
      only: typeof args.flags.only === "string" ? args.flags.only : undefined,
    });
  },
  "tenant-migrate": async (args) => {
    await runTenantMigrate({
      orgId: typeof args.flags.org === "string" ? args.flags.org : undefined,
      all: args.flags.all === true,
    });
  },
  "tenant-seed": async (args) => {
    await runTenantSeed({
      orgId: typeof args.flags.org === "string" ? args.flags.org : undefined,
      all: args.flags.all === true,
      only: typeof args.flags.only === "string" ? args.flags.only : undefined,
    });
  },
};

function usage(): void {
  console.error(
    [
      "Usage: bun infra/scripts/src/index.ts <command> [flags]",
      "",
      "Commands:",
      "  tenant-health --org=<uuid>|--all [--fix] [--only=<check1,check2>]",
      "    Runs tenant health checks. Without --fix, reports issues only.",
      "  tenant-migrate --org=<uuid>|--all",
      "    Runs pending drizzle migrations against each tenant DB. Auto-stamps",
      "    the baseline for tenants that pre-date committed migrations.",
      "  tenant-seed --org=<uuid>|--all [--only=<seed1,seed2>]",
      "    Reconciles tenant catalogs from @mspbyte/shared. Idempotent.",
      "",
      "Checks:",
      "  link-meta    Reconciles integration_links.meta against each vendor's",
      "               current schema version. HaloPSA uses one site.list per org.",
      "  dead-letter  Replays raw_records with projectionStatus='failed' via",
      "               projectBatch. Records that now normalize cleanly are",
      "               marked recovered; still-failing rows keep their new error.",
      "",
      "Seeds:",
      "  system-roles  Upserts the canonical role catalog (Auditor..Global",
      "                Administrator) from SYSTEM_ROLES in @mspbyte/shared.",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const command = args.positional[0];
  if (!command || !COMMANDS[command]) {
    usage();
    process.exit(command ? 1 : 0);
  }
  await COMMANDS[command](args);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack ?? error.message : error);
  process.exit(1);
});
