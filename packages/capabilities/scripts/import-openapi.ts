import { mkdir, stat } from 'node:fs/promises';
import { dirname } from 'node:path';

type OpenApiParameter = {
  name?: string;
  in?: 'path' | 'query' | 'header' | 'cookie';
  required?: boolean;
  description?: string;
  schema?: { type?: string; format?: string; items?: { type?: string } };
};

type OpenApiOperation = {
  operationId?: string;
  summary?: string;
  description?: string;
  parameters?: Array<OpenApiParameter | { $ref: string }>;
  requestBody?: { content?: Record<string, { schema?: unknown }> } | { $ref: string };
  responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
};

type OpenApiDocument = {
  openapi?: string;
  swagger?: string;
  servers?: Array<{ url?: string }>;
  paths?: Record<string, Record<string, OpenApiOperation | OpenApiParameter[]>>;
  components?: { parameters?: Record<string, OpenApiParameter>; requestBodies?: Record<string, OpenApiOperation['requestBody']> };
};

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
    'Usage: bun run import:openapi -- --input <spec.yaml> --output <candidates.json> --integration <id> --vendor <label> --connection configured|activeLink --operation <operationId[,operationId...]> [--source <canonical-url>] [--overwrite]',
  );
}

function parseArgs(argv: string[]): Required<Args> {
  const args: Args = { operations: new Set(), overwrite: false };
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const value = argv[index + 1];
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
    index++;
  }
  if (!args.input || !args.output || !args.integration || !args.vendor || !args.connection || args.operations.size === 0) usage();
  return args as Required<Args>;
}

function resolveLocalRef<T>(value: T | { $ref: string } | undefined, document: OpenApiDocument): T | undefined {
  if (!value || !('$ref' in value)) return value;
  const parts = value.$ref.split('/');
  if (parts[0] !== '#' || parts.length !== 4 || parts[1] !== 'components') return undefined;
  const group = parts[2] as 'parameters' | 'requestBodies';
  return document.components?.[group]?.[parts[3]] as T | undefined;
}

function labelFor(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function typeMetadata(parameter: OpenApiParameter) {
  const schema = parameter.schema ?? {};
  if (schema.type === 'boolean') return { valueType: 'boolean', typeHint: 'boolean' };
  if (schema.type === 'integer' || schema.type === 'number') return { valueType: 'number', typeHint: 'number' };
  if (schema.type === 'array') return { valueType: 'text_list', typeHint: 'stringArray' };
  if (schema.format === 'uuid') return { valueType: 'uuid', typeHint: 'text' };
  return { valueType: 'text', typeHint: 'text' };
}

function successStatusCodes(operation: OpenApiOperation): number[] {
  const statuses = Object.keys(operation.responses ?? {})
    .filter((code) => /^2\d\d$/.test(code))
    .map(Number);
  return statuses.length > 0 ? statuses : [200];
}

function candidateId(integration: string, operationId: string): string {
  return `${integration}.${operationId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '')}`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const input = Bun.file(args.input!);
  if (!(await input.exists())) throw new Error(`OpenAPI input not found: ${args.input}`);
  const text = await input.text();
  const document = (args.input!.endsWith('.json') ? JSON.parse(text) : Bun.YAML.parse(text)) as OpenApiDocument;
  if (!document.openapi && !document.swagger) throw new Error('Input is not an OpenAPI or Swagger document.');

  const found = new Map<string, { path: string; method: string; operation: OpenApiOperation; pathParameters: OpenApiParameter[] }>();
  for (const [path, item] of Object.entries(document.paths ?? {})) {
    const pathParameters = ((item.parameters as Array<OpenApiParameter | { $ref: string }> | undefined) ?? [])
      .map((parameter) => resolveLocalRef<OpenApiParameter>(parameter, document))
      .filter((parameter): parameter is OpenApiParameter => !!parameter);
    for (const [method, operation] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || Array.isArray(operation)) continue;
      const operationId = operation.operationId;
      if (operationId && args.operations.has(operationId)) found.set(operationId, { path, method, operation, pathParameters });
    }
  }
  const missing = [...args.operations].filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Requested operation IDs were not found: ${missing.join(', ')}`);

  const candidates = [...found.entries()].map(([operationId, entry]) => {
    const parameters = [...entry.pathParameters, ...((entry.operation.parameters ?? [])
      .map((parameter) => resolveLocalRef<OpenApiParameter>(parameter, document))
      .filter((parameter): parameter is OpenApiParameter => !!parameter))]
      .filter((parameter) => parameter.in !== 'cookie')
      .map((parameter) => ({
        input: parameter.name!, name: parameter.name!, in: parameter.in!, required: parameter.required ?? parameter.in === 'path',
      }));
    const inputMeta = Object.fromEntries(parameters.map((parameter) => {
      const source = [...entry.pathParameters, ...(entry.operation.parameters ?? [])]
        .map((item) => resolveLocalRef<OpenApiParameter>(item as OpenApiParameter | { $ref: string }, document))
        .find((item) => item?.name === parameter.name && item.in === parameter.in)!;
      return [parameter.input, {
        allowedBindings: ['literal', 'runtime'], label: labelFor(parameter.name), description: source.description,
        required: parameter.required, ...typeMetadata(source),
      }];
    }));
    const requestBody = resolveLocalRef<NonNullable<OpenApiOperation['requestBody']>>(entry.operation.requestBody, document);
    const hasJsonBody = !!requestBody?.content?.['application/json'];
    return {
      id: candidateId(args.integration, operationId),
      integration: { integrationId: args.integration, connection: args.connection },
      vendor: args.vendor, name: entry.operation.summary ?? labelFor(operationId),
      description: entry.operation.description ?? `Generated candidate for ${entry.method.toUpperCase()} ${entry.path}.`,
      category: 'admin',
      operation: {
        source: 'openapi', operationId, method: entry.method.toUpperCase(), path: entry.path,
        parameters,
        ...(hasJsonBody ? { body: { input: 'body', contentType: 'application/json' } } : {}),
        successStatusCodes: successStatusCodes(entry.operation), response: { source: 'body' },
      },
      inputSchemaName: `${operationId}Inputs`, outputSchemaName: `${operationId}Outputs`, inputMeta, outputMeta: {},
      review: {
        required: true,
        reasons: [
          'Review request-body schema and flatten or map its fields.',
          'Assign a product category, action label, audit action, permission, and output metadata.',
          'Confirm idempotency, sensitive fields, entity mappings, and dynamic sources.',
        ],
      },
    };
  });

  const seenIds = new Set<string>();
  for (const candidate of candidates) {
    if (seenIds.has(candidate.id)) {
      throw new Error(`Candidate ID collision: "${candidate.id}" — two operation IDs normalized to the same slug. Rename one or contact the spec owner.`);
    }
    seenIds.add(candidate.id);
  }

  if (!args.overwrite) {
    try { await stat(args.output!); throw new Error(`Output already exists: ${args.output}. Pass --overwrite to replace it.`); }
    catch (error) { if (!(error as NodeJS.ErrnoException).code || (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  await mkdir(dirname(args.output!), { recursive: true });
  await Bun.write(args.output!, `${JSON.stringify({
    source: args.source ?? args.input,
    candidates: candidates.map((candidate) => ({
      ...candidate,
      lifecycle: { status: 'generated' as const, smokeTests: [] },
    })),
  }, null, 2)}\n`);
  console.log(`Generated ${candidates.length} reviewed OpenAPI candidate(s) at ${args.output}`);
}

await main();
