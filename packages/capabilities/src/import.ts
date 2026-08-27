import { load as parseYaml } from 'js-yaml';

export type OpenApiParameter = {
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

export type OpenApiDocument = {
  openapi?: string;
  swagger?: string;
  paths?: Record<string, Record<string, OpenApiOperation | OpenApiParameter[]>>;
  components?: {
    parameters?: Record<string, OpenApiParameter>;
    requestBodies?: Record<string, OpenApiOperation['requestBody']>;
  };
};

export type ImportedCandidate = {
  id: string;
  integration: { integrationId: string; connection: 'configured' | 'activeLink' };
  vendor: string;
  name: string;
  description: string;
  category: string;
  operation: {
    source: 'openapi';
    operationId: string;
    method: string;
    path: string;
    parameters: Array<{ input: string; name: string; in: string; required: boolean }>;
    body?: { input: string; contentType: string };
    successStatusCodes: number[];
    response: { source: 'body' };
  };
  inputMeta: Record<string, {
    allowedBindings: string[];
    label: string;
    description?: string;
    required?: boolean;
    valueType?: string;
    typeHint?: string;
  }>;
  outputMeta: Record<string, unknown>;
  lifecycle: { status: 'generated' | 'approved' | 'live' | 'rejected' };
};

export type OperationPreview = {
  operationId: string;
  method: string;
  path: string;
  summary?: string;
};

export function parseOpenApiText(text: string): OpenApiDocument {
  const trimmed = text.trimStart();
  const doc = trimmed.startsWith('{') || trimmed.startsWith('[')
    ? JSON.parse(text)
    : parseYaml(text);
  if (!doc || typeof doc !== 'object') throw new Error('Could not parse spec as JSON or YAML.');
  if (!(doc as OpenApiDocument).openapi && !(doc as OpenApiDocument).swagger) {
    throw new Error('Input does not appear to be an OpenAPI or Swagger document.');
  }
  return doc as OpenApiDocument;
}

function resolveRef<T extends object>(
  value: T | { $ref: string } | undefined,
  doc: OpenApiDocument,
): T | undefined {
  if (!value) return undefined;
  if (!('$ref' in value)) return value as T;
  const ref = (value as { $ref: string }).$ref;
  const parts = ref.split('/');
  if (parts[0] !== '#' || parts.length !== 4 || parts[1] !== 'components') return undefined;
  const group = parts[2] as 'parameters' | 'requestBodies';
  return doc.components?.[group]?.[parts[3]!] as T | undefined;
}

function labelFor(value: string): string {
  return value
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function typeMetadata(param: OpenApiParameter) {
  const schema = param.schema ?? {};
  if (schema.type === 'boolean') return { valueType: 'boolean', typeHint: 'boolean' };
  if (schema.type === 'integer' || schema.type === 'number') return { valueType: 'number', typeHint: 'number' };
  if (schema.type === 'array') return { valueType: 'text_list', typeHint: 'stringArray' };
  if (schema.format === 'uuid') return { valueType: 'uuid', typeHint: 'text' };
  return { valueType: 'text', typeHint: 'text' };
}

function successCodes(op: OpenApiOperation): number[] {
  const codes = Object.keys(op.responses ?? {})
    .filter((c) => /^2\d\d$/.test(c))
    .map(Number);
  return codes.length > 0 ? codes : [200];
}

function buildCandidateId(integration: string, operationId: string): string {
  return `${integration}.${operationId
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .toLowerCase()
    .replace(/^-+|-+$/g, '')}`;
}

export type BodyFieldEntry = {
  name: string;
  description?: string;
  valueType: 'text' | 'number' | 'boolean' | 'text_list' | 'uuid' | 'object';
  required: boolean;
};

/** Resolve a JSON schema node to a flat property map (handles $ref + allOf one level deep). */
function resolveSchemaProperties(
  schema: unknown,
  doc: OpenApiDocument,
  depth = 0,
): Record<string, { description?: string; type?: string; format?: string; items?: { type?: string }; required?: boolean }> {
  if (depth > 3 || !schema || typeof schema !== 'object') return {};
  const s = schema as Record<string, unknown>;

  // $ref resolution
  if ('$ref' in s && typeof s.$ref === 'string') {
    const parts = (s.$ref as string).split('/');
    if (parts[0] === '#' && parts[1] === 'components' && parts[2] === 'schemas') {
      const ref = (doc as unknown as { components?: { schemas?: Record<string, unknown> } }).components?.schemas?.[parts[3]!];
      return ref ? resolveSchemaProperties(ref, doc, depth + 1) : {};
    }
    return {};
  }

  const props: Record<string, unknown> = {};
  const required = new Set<string>(Array.isArray(s.required) ? (s.required as string[]) : []);

  // allOf: merge properties from each sub-schema
  if (Array.isArray(s.allOf)) {
    for (const sub of s.allOf as unknown[]) {
      Object.assign(props, resolveSchemaProperties(sub, doc, depth + 1));
    }
  }

  // Direct properties
  if (s.properties && typeof s.properties === 'object') {
    for (const [name, def] of Object.entries(s.properties as Record<string, unknown>)) {
      (props as Record<string, unknown>)[name] = { ...(def as object), required: required.has(name) };
    }
  }

  return props as Record<string, { description?: string; type?: string; format?: string; items?: { type?: string }; required?: boolean }>;
}

function schemaTypeToValueType(prop: { type?: string; format?: string; items?: { type?: string } }): BodyFieldEntry['valueType'] {
  if (prop.type === 'boolean') return 'boolean';
  if (prop.type === 'integer' || prop.type === 'number') return 'number';
  if (prop.type === 'array') return 'text_list';
  if (prop.type === 'object') return 'object';
  if (prop.format === 'uuid') return 'uuid';
  return 'text';
}

/** Extract the body schema properties for a specific operation from a parsed spec. */
export function extractBodyFields(doc: OpenApiDocument, operationId: string): BodyFieldEntry[] {
  for (const [, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || Array.isArray(op)) continue;
      if ((op as OpenApiOperation).operationId !== operationId) continue;

      const reqBody = resolveRef<NonNullable<OpenApiOperation['requestBody']>>(
        (op as OpenApiOperation).requestBody,
        doc,
      );
      if (!reqBody || !('content' in reqBody)) return [];

      const jsonContent = reqBody.content?.['application/json'];
      if (!jsonContent?.schema) return [];

      const props = resolveSchemaProperties(jsonContent.schema, doc);
      return Object.entries(props)
        .slice(0, 80)
        .map(([name, def]) => ({
          name,
          description: def.description,
          valueType: schemaTypeToValueType(def),
          required: def.required ?? false,
        }));
    }
  }
  return [];
}

/** List all operation IDs in a spec (for the preview/select step). */
export function listOperations(doc: OpenApiDocument): OperationPreview[] {
  const out: OperationPreview[] = [];
  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || Array.isArray(op)) continue;
      if (op.operationId) {
        out.push({ operationId: op.operationId, method: method.toUpperCase(), path, summary: op.summary });
      }
    }
  }
  return out.sort((a, b) => a.operationId.localeCompare(b.operationId));
}

/** Build candidates for a subset of operation IDs from a parsed spec. */
export function buildCandidates(
  doc: OpenApiDocument,
  opts: {
    integration: string;
    vendor: string;
    connection: 'configured' | 'activeLink';
    operations: string[];
    source?: string;
  },
): ImportedCandidate[] {
  const found = new Map<string, { path: string; method: string; op: OpenApiOperation; pathParams: OpenApiParameter[] }>();

  for (const [path, item] of Object.entries(doc.paths ?? {})) {
    const pathParams = ((item.parameters as Array<OpenApiParameter | { $ref: string }> | undefined) ?? [])
      .map((p) => resolveRef<OpenApiParameter>(p, doc))
      .filter((p): p is OpenApiParameter => !!p);

    for (const [method, op] of Object.entries(item)) {
      if (!['get', 'post', 'put', 'patch', 'delete'].includes(method) || Array.isArray(op)) continue;
      if (op.operationId && opts.operations.includes(op.operationId)) {
        found.set(op.operationId, { path, method, op, pathParams });
      }
    }
  }

  const missing = opts.operations.filter((id) => !found.has(id));
  if (missing.length > 0) throw new Error(`Operation IDs not found in spec: ${missing.join(', ')}`);

  const seenIds = new Set<string>();
  const candidates: ImportedCandidate[] = [];

  for (const [operationId, entry] of found) {
    const parameters = [
      ...entry.pathParams,
      ...((entry.op.parameters ?? [])
        .map((p) => resolveRef<OpenApiParameter>(p, doc))
        .filter((p): p is OpenApiParameter => !!p)),
    ]
      .filter((p) => p.in !== 'cookie')
      .map((p) => ({
        input: p.name!,
        name: p.name!,
        in: p.in!,
        required: p.required ?? p.in === 'path',
      }));

    const inputMeta = Object.fromEntries(
      parameters.map((p) => {
        const source = [
          ...entry.pathParams,
          ...((entry.op.parameters ?? []) as Array<OpenApiParameter | { $ref: string }>),
        ]
          .map((item) => resolveRef<OpenApiParameter>(item as OpenApiParameter | { $ref: string }, doc))
          .find((item) => item?.name === p.name && item.in === p.in)!;
        return [
          p.input,
          {
            allowedBindings: ['literal', 'runtime'],
            label: labelFor(p.name),
            description: source?.description,
            required: p.required,
            ...typeMetadata(source ?? {}),
          },
        ];
      }),
    );

    const reqBody = resolveRef<NonNullable<OpenApiOperation['requestBody']>>(entry.op.requestBody, doc);
    const hasJsonBody = !!reqBody && 'content' in reqBody && !!reqBody.content?.['application/json'];

    const candidateId = buildCandidateId(opts.integration, operationId);
    if (seenIds.has(candidateId)) {
      throw new Error(`Candidate ID collision: "${candidateId}" — two operation IDs produced the same slug.`);
    }
    seenIds.add(candidateId);

    candidates.push({
      id: candidateId,
      integration: { integrationId: opts.integration, connection: opts.connection },
      vendor: opts.vendor,
      name: entry.op.summary ?? labelFor(operationId),
      description: entry.op.description ?? `Generated candidate for ${entry.method.toUpperCase()} ${entry.path}.`,
      category: 'admin',
      operation: {
        source: 'openapi',
        operationId,
        method: entry.method.toUpperCase(),
        path: entry.path,
        parameters,
        ...(hasJsonBody ? { body: { input: 'body', contentType: 'application/json' } } : {}),
        successStatusCodes: successCodes(entry.op),
        response: { source: 'body' },
      },
      inputMeta,
      outputMeta: {
        data: { label: 'Response Data', description: 'The API response body. Use dot-notation paths like data.id to bind downstream.', valueType: 'object' },
        status: { label: 'HTTP Status', description: 'The HTTP status code returned by the vendor API.', valueType: 'number' },
      },
      lifecycle: { status: 'generated' },
    });
  }

  return candidates;
}
