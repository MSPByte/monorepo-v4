import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { scaffoldCapability, scaffoldFilename } from '../src/scaffold.js';
import type { ImportedCandidate } from '../src/import.js';

function usage(): never {
  throw new Error(
    'Usage: bun run scaffold:openapi -- --input <candidates.json> --output-dir <src/vendor/> [--operation <candidate-id>] [--overwrite]',
  );
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const input = argument('--input');
  const outputDir = argument('--output-dir');
  const operationFilter = argument('--operation');
  const overwrite = process.argv.includes('--overwrite');

  if (!input || !outputDir) usage();

  const file = Bun.file(input!);
  if (!(await file.exists())) throw new Error(`Candidates file not found: ${input}`);

  const document = JSON.parse(await file.text()) as { candidates?: ImportedCandidate[] };
  const all = document.candidates ?? [];

  const toScaffold = all.filter((c) => {
    if (operationFilter && c.id !== operationFilter) return false;
    return c.lifecycle?.status === 'approved';
  });

  if (toScaffold.length === 0) {
    const filter = operationFilter ? ` matching "${operationFilter}"` : '';
    console.log(`No approved candidates${filter} found in ${input}.`);
    return;
  }

  await mkdir(outputDir!, { recursive: true });

  for (const candidate of toScaffold) {
    const outPath = join(outputDir!, scaffoldFilename(candidate));
    const outFile = Bun.file(outPath);
    if (!overwrite && (await outFile.exists())) {
      console.log(`Skipping ${candidate.id} — ${outPath} already exists. Pass --overwrite to replace.`);
      continue;
    }
    await Bun.write(outPath, scaffoldCapability(candidate));
    console.log(`Scaffolded ${candidate.id} → ${outPath}`);
  }

  console.log(`\nNext steps:
  1. Fill in each TODO in the generated file(s).
  2. Add the export to the relevant vendor index (e.g. src/m365/index.ts).
  3. Register the capability in src/registry.ts.
  4. Run bun run check-types to verify.
  5. Mark live in the Capabilities Workshop or via review:openapi.`);
}

await main();
