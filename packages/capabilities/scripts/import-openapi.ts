import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { parseOpenApiText, listOperations, buildCandidates } from '../src/import.js';

type Args = {
  input?: string;
  output?: string;
  integration?: string;
  vendor?: string;
  source?: string;
  connection?: 'configured' | 'activeLink';
  operations: Set<string>;
  overwrite: boolean;
};

function usage(): never {
  throw new Error(
    'Usage: bun run import:openapi -- --input <spec.yaml> --output <candidates.json> --integration <id> --vendor <label> --connection configured|activeLink --operation <operationId[,operationId...]> [--source <url>] [--overwrite]',
  );
}

function parseArgs(argv: string[]): Required<Args> {
  const args: Args = { operations: new Set(), overwrite: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = argv[i + 1];
    if (arg === '--overwrite') { args.overwrite = true; continue; }
    if (!value) usage();
    if (arg === '--input') args.input = value;
    else if (arg === '--output') args.output = value;
    else if (arg === '--integration') args.integration = value;
    else if (arg === '--vendor') args.vendor = value;
    else if (arg === '--source') args.source = value;
    else if (arg === '--connection' && (value === 'configured' || value === 'activeLink')) args.connection = value;
    else if (arg === '--operation') value.split(',').filter(Boolean).forEach((id) => args.operations.add(id));
    else usage();
    i++;
  }
  if (!args.input || !args.output || !args.integration || !args.vendor || !args.connection || args.operations.size === 0) usage();
  return args as Required<Args>;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const file = Bun.file(args.input);
  if (!(await file.exists())) throw new Error(`OpenAPI input not found: ${args.input}`);
  const text = await file.text();

  const doc = parseOpenApiText(text);
  const available = listOperations(doc).map((o) => o.operationId);
  const missing = [...args.operations].filter((id) => !available.includes(id));
  if (missing.length > 0) {
    console.error(`\nAvailable operation IDs:\n${available.map((id) => `  ${id}`).join('\n')}`);
    throw new Error(`Requested operation IDs not found: ${missing.join(', ')}`);
  }

  const candidates = buildCandidates(doc, {
    integration: args.integration,
    vendor: args.vendor,
    connection: args.connection,
    operations: [...args.operations],
    source: args.source,
  });

  if (!args.overwrite) {
    try {
      await stat(args.output);
      throw new Error(`Output already exists: ${args.output}. Pass --overwrite to replace it.`);
    } catch (error) {
      if (!(error as NodeJS.ErrnoException).code || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  await mkdir(dirname(args.output), { recursive: true });
  await Bun.write(
    args.output,
    `${JSON.stringify({ source: args.source ?? args.input, candidates }, null, 2)}\n`,
  );
  console.log(`Generated ${candidates.length} candidate(s) → ${args.output}`);
}

await main();
