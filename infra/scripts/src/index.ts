import { parseArgs } from "./args.js";
import { runTenantHealth } from "./tenant-health/index.js";

const COMMANDS: Record<string, (args: ReturnType<typeof parseArgs>) => Promise<void>> = {
  "tenant-health": async (args) => {
    await runTenantHealth({
      orgId: typeof args.flags.org === "string" ? args.flags.org : undefined,
      all: args.flags.all === true,
      fix: args.flags.fix === true,
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
      "",
      "Checks:",
      "  link-meta    Reconciles integration_links.meta against each vendor's",
      "               current schema version. HaloPSA uses one site.list per org.",
      "  dead-letter  Replays raw_records with projectionStatus='failed' via",
      "               projectBatch. Records that now normalize cleanly are",
      "               marked recovered; still-failing rows keep their new error.",
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
