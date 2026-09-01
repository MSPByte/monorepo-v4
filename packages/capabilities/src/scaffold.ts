import type { ImportedCandidate } from './import.js';

function toCamelCase(slug: string): string {
  return slug
    .replace(/[^a-zA-Z0-9]+(.)/g, (_, c: string) => c.toUpperCase())
    .replace(/^(.)/, (c: string) => c.toLowerCase());
}

function toConstName(id: string): string {
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

function connectorImport(integrationId: string): string {
  if (integrationId === 'microsoft-365') {
    return `import { classifyGraphError } from '../m365/classify-error.js';`;
  }
  return `// TODO: import error classifier for ${integrationId}`;
}

export function scaffoldFilename(candidate: ImportedCandidate): string {
  return candidate.id.split('.').slice(1).join('-').replace(/[^a-z0-9-]/gi, '-') + '.ts';
}

export function scaffoldCapability(candidate: ImportedCandidate): string {
  const constName = toConstName(candidate.id);

  const inputFields = Object.entries(candidate.inputMeta)
    .map(([key, meta]) => {
      const zodType = zodTypeFor(meta.valueType, meta.typeHint);
      const optional = meta.required === false ? '.optional()' : '';
      return `  ${key}: ${zodType}${optional},`;
    })
    .join('\n');

  const parameters = (candidate.operation.parameters ?? [])
    .map((p) => `    { input: '${p.input}', name: '${p.name}', in: '${p.in}'${p.required !== false ? ', required: true' : ''} },`)
    .join('\n');

  const inputMetaEntries = Object.entries(candidate.inputMeta)
    .map(([key, meta]) => {
      const parts: string[] = [];
      parts.push(`      allowedBindings: [${meta.allowedBindings.map((b) => `'${b}'`).join(', ')}],`);
      if (meta.label) parts.push(`      label: '${meta.label}',`);
      if (meta.description) parts.push(`      description: '${meta.description.replace(/'/g, "\\'")}',`);
      if (meta.required !== undefined) parts.push(`      required: ${meta.required},`);
      if (meta.valueType) parts.push(`      valueType: '${meta.valueType}',`);
      if (meta.typeHint) parts.push(`      typeHint: '${meta.typeHint}',`);
      return `    ${key}: {\n${parts.join('\n')}\n    },`;
    })
    .join('\n');

  const hasBody = !!candidate.operation.body;
  const errorImport = connectorImport(candidate.integration.integrationId);

  return `// SCAFFOLD — fill in TODOs before registering in registry.ts
// Candidate: ${candidate.id}
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
    fanout: ${JSON.stringify(candidate.operation.fanout ?? { mode: 'single_run' })},
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
  defaultUnitPrice: 0.02,
  async handler(ctx, input) {
    // TODO: implement. Typical Graph operation pattern:
    // 1. Resolve MSPByte entity → vendor external ID
    //    const identity = await ctx.loadM365Identity(input.identityId);
    //    if (!identity) return { outcome: 'fail', errorClass: 'not_found', message: 'Identity not found' };
    // 2. Build typed request from the manifest
    //    const request = buildOpenApiRequest(${constName}.operation, {
    //      /* path/query params */ body: { /* body fields */ },
    //    });
    // 3. Execute via connector
    //    const connector = await ctx.getM365Connector(identity.linkId);
    //    const result = await connector.operations.execute(request);
    //    if (!${constName}.operation.successStatusCodes.includes(result.status)) {
    //      return { outcome: 'fail', errorClass: 'vendor_error', message: \`Unexpected status \${result.status}\` };
    //    }
    //    return { outcome: 'success', outputs: { /* ... */ } };
    throw new Error('Handler not implemented');
    // try { ... } catch (error) { return classifyGraphError(error); }
  },
});
`;
}
