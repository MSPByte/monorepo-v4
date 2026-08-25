import { mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

type LifecycleStatus = 'generated' | 'approved' | 'live' | 'rejected';

type CandidateOperation = {
  source: 'openapi';
  operationId: string;
  method: string;
  path: string;
  parameters?: Array<{ input: string; name: string; in: string; required?: boolean }>;
  body?: { input: string; contentType: string };
  successStatusCodes: number[];
  response: { source: string };
};

type Candidate = {
  id: string;
  integration: { integrationId: string; connection: 'configured' | 'activeLink' };
  vendor: string;
  name: string;
  description: string;
  category: string;
  operation: CandidateOperation;
  inputMeta: Record<string, {
    label?: string;
    description?: string;
    required?: boolean;
    valueType?: string;
    typeHint?: string;
    allowedBindings: string[];
  }>;
  outputMeta: Record<string, unknown>;
  lifecycle?: { status: LifecycleStatus; approvedAt?: string };
};

function usage(): never {
  throw new Error(
    'Usage: bun run scaffold:openapi -- --input <candidates.json> --output-dir <src/vendor/> [--operation <candidate-id>] [--overwrite]',
  );
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function toCamelCase(slug: string): string {
  return slug
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase())
    .replace(/^(.)/, (char: string) => char.toLowerCase());
}

function toConstName(id: string): string {
  // microsoft-365.identity.enable → m365IdentityEnable
  // strip the integration prefix, camelCase the rest
  const parts = id.split('.');
  const operationPart = parts.length > 1 ? parts.slice(1).join('.') : id;
  return toCamelCase(operationPart);
}

function zodTypeFor(valueType?: string, typeHint?: string): string {
  if (typeHint === 'boolean' || valueType === 'boolean') return 'z.boolean()';
  if (typeHint === 'number' || valueType === 'number') return 'z.number()';
  if (typeHint === 'stringArray' || valueType === 'text_list') return 'z.array(z.string())';
  if (valueType === 'uuid') return 'z.string().uuid()';
  return 'z.string()';
}

function renderInputField(key: string, meta: Candidate['inputMeta'][string]): string {
  const zodType = zodTypeFor(meta.valueType, meta.typeHint);
  const optional = meta.required === false ? '.optional()' : '';
  return `  ${key}: ${zodType}${optional},`;
}

function renderParameter(p: CandidateOperation['parameters'][number]): string {
  return `    { input: '${p.input}', name: '${p.name}', in: '${p.in}'${p.required !== false ? ', required: true' : ''} },`;
}

function renderInputMeta(key: string, meta: Candidate['inputMeta'][string]): string {
  const parts: string[] = [];
  parts.push(`      allowedBindings: [${meta.allowedBindings.map((b) => `'${b}'`).join(', ')}],`);
  if (meta.label) parts.push(`      label: '${meta.label}',`);
  if (meta.description) parts.push(`      description: '${meta.description.replace(/'/g, "\\'")}',`);
  if (meta.required !== undefined) parts.push(`      required: ${meta.required},`);
  if (meta.valueType) parts.push(`      valueType: '${meta.valueType}',`);
  if (meta.typeHint) parts.push(`      typeHint: '${meta.typeHint}',`);
  return `    ${key}: {\n${parts.join('\n')}\n    },`;
}

function connectorImport(integrationId: string): string {
  if (integrationId === 'microsoft-365') return `import { classifyGraphError } from '../classify-error.js';`;
  return `// TODO: import error classifier for ${integrationId}`;
}

function scaffoldCapability(candidate: Candidate): string {
  const constName = toConstName(candidate.id);
  const inputFields = Object.entries(candidate.inputMeta)
    .map(([key, meta]) => renderInputField(key, meta))
    .join('\n');
  const parameters = (candidate.operation.parameters ?? [])
    .map(renderParameter)
    .join('\n');
  const inputMetaEntries = Object.entries(candidate.inputMeta)
    .map(([key, meta]) => renderInputMeta(key, meta))
    .join('\n');
  const hasBody = !!candidate.operation.body;

  const errorImport = connectorImport(candidate.integration.integrationId);

  return `// SCAFFOLD — fill in TODOs before registering in registry.ts
// Candidate: ${candidate.id}
// Approved: ${candidate.lifecycle?.approvedAt ?? 'unknown'}
// Authoring guide: packages/capabilities/CAPABILITY_AUTHORING.md
import { z } from 'zod';
import { buildOpenApiRequest, defineOpenApiCapability } from '../openapi.js';
${errorImport}

// TODO: refine input schema — add entity fields, remove unused params
const inputs = z.object({
${inputFields || '  // no parameters detected — add body fields here'}
});

// TODO: define output schema from the API response shape
const outputs = z.object({
  // id: z.string(),
});

export const ${constName} = defineOpenApiCapability({
  id: '${candidate.id}',
  vendor: '${candidate.vendor}',
  integration: { integrationId: '${candidate.integration.integrationId}', connection: '${candidate.integration.connection}' },
  name: '${candidate.name}',
  description: '${candidate.description.replace(/'/g, "\\'")}',
  category: '${candidate.category}', // TODO: confirm — identity | license | group | role | device | admin | site
  operation: {
    source: 'openapi',
    operationId: '${candidate.operation.operationId}',
    method: '${candidate.operation.method}',
    path: '${candidate.operation.path}',
${parameters ? `    parameters: [\n${parameters}\n    ],` : '    parameters: [],'}
${hasBody ? `    body: { input: 'body', contentType: '${candidate.operation.body!.contentType}' },` : ''}
    successStatusCodes: [${candidate.operation.successStatusCodes.join(', ')}],
    response: { source: 'body' },
  },
  inputs,
  outputs,
  inputMeta: {
${inputMetaEntries || '    // no params detected'}
  },
  outputMeta: {
    // TODO: describe outputs — label, outputType, sensitive
  },
  actionLabel: 'TODO' as any, // TODO: add to ActionLabels in @mspbyte/shared
  auditAction: 'update', // TODO: choose update | create | delete
  requiredPermission: 'Vendors.Write', // TODO: confirm
  defaultUnitPrice: 0.02, // TODO: set price
  async handler(ctx, input) {
    // TODO: implement — typical steps for a Graph operation:
    // 1. Resolve MSPByte entity IDs to vendor external IDs
    //    const identity = await ctx.loadM365Identity(input.identityId);
    //    if (!identity) return { outcome: 'fail', errorClass: 'not_found', message: 'Identity not found' };
    // 2. Build the typed request from the manifest
    //    const request = buildOpenApiRequest(${constName}.operation, {
    //      /* path/query params from resolved inputs */
    //      body: { /* body fields */ },
    //    });
    // 3. Get the connector and execute
    //    const connector = await ctx.getM365Connector(identity.linkId);
    //    const result = await connector.operations.execute(request);
    //    if (!${constName}.operation.successStatusCodes.includes(result.status)) {
    //      return { outcome: 'fail', errorClass: 'vendor_error', message: \`Unexpected status \${result.status}\` };
    //    }
    // 4. Return outputs (wrap in try/catch using classifyGraphError)
    throw new Error('Handler not implemented');
    // try { ... } catch (error) { return classifyGraphError(error); }
  },
});
`;
}

async function main() {
  const input = argument('--input');
  const outputDir = argument('--output-dir');
  const operationFilter = argument('--operation');
  const overwrite = process.argv.includes('--overwrite');

  if (!input || !outputDir) usage();

  const file = Bun.file(input!);
  if (!(await file.exists())) throw new Error(`Candidates file not found: ${input}`);

  const document = JSON.parse(await file.text()) as { candidates?: Candidate[] };
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
    const slug = candidate.id.split('.').slice(1).join('-').replace(/[^a-z0-9-]/gi, '-');
    const outPath = join(outputDir!, `${slug}.ts`);
    const outFile = Bun.file(outPath);
    if (!overwrite && (await outFile.exists())) {
      console.log(`Skipping ${candidate.id} — ${outPath} already exists. Pass --overwrite to replace.`);
      continue;
    }
    const source = scaffoldCapability(candidate);
    await Bun.write(outPath, source);
    console.log(`Scaffolded ${candidate.id} → ${outPath}`);
  }

  console.log(`\nNext steps:
  1. Fill in each TODO in the generated file(s).
  2. Add the export to the relevant vendor index (e.g. src/m365/index.ts).
  3. Register the capability in src/registry.ts.
  4. Run bun run check-types to verify the implementation.
  5. Mark the candidate live: bun run review:openapi -- --input ${input} --operation <id> --status live --evidence package-run:<id>`);
}

await main();
