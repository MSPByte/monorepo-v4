import { stat } from 'node:fs/promises';

type LifecycleStatus = 'generated' | 'approved' | 'live' | 'rejected';
type Candidate = {
  id: string;
  lifecycle?: {
    status: LifecycleStatus;
    smokeTests?: Array<{ evidence: string; testedAt: string; notes?: string }>;
    approvedAt?: string;
    rejectedAt?: string;
    liveAt?: string;
    notes?: string;
  };
};

function usage(): never {
  throw new Error(
    'Usage: bun run review:openapi -- --input <candidates.json> --operation <candidate-id> --status approved|live|rejected --evidence <test-run-or-url> [--notes <text>]',
  );
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

async function main() {
  const input = argument('--input');
  const operation = argument('--operation');
  const status = argument('--status') as LifecycleStatus | undefined;
  const evidence = argument('--evidence');
  const notes = argument('--notes');
  if (!input || !operation || !status || !['approved', 'live', 'rejected'].includes(status) || !evidence) usage();
  await stat(input);
  const document = JSON.parse(await Bun.file(input).text()) as { candidates?: Candidate[] };
  const candidate = document.candidates?.find((entry) => entry.id === operation);
  if (!candidate) throw new Error(`Candidate not found: ${operation}`);
  const lifecycle = candidate.lifecycle ?? { status: 'generated' as const, smokeTests: [] };
  if (status === 'live' && lifecycle.status !== 'approved') {
    throw new Error(`Only approved candidates can go live; ${operation} is ${lifecycle.status}.`);
  }
  const testedAt = new Date().toISOString();
  lifecycle.smokeTests = [...(lifecycle.smokeTests ?? []), { evidence, testedAt, ...(notes ? { notes } : {}) }];
  lifecycle.status = status;
  if (status === 'approved') lifecycle.approvedAt = testedAt;
  if (status === 'rejected') lifecycle.rejectedAt = testedAt;
  if (status === 'live') lifecycle.liveAt = testedAt;
  lifecycle.notes = notes ?? lifecycle.notes;
  candidate.lifecycle = lifecycle;
  await Bun.write(input, `${JSON.stringify(document, null, 2)}\n`);
  console.log(`${operation} is now ${status}.`);
}

await main();
