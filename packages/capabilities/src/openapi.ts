import type { z } from 'zod';
import type {
  Capability,
  CapabilityIntegrationRequirement,
  CapabilityFanout,
  InputGroupMeta,
  InputMetaEntry,
  OutputMetaEntry,
} from './types.js';

/**
 * The declarative source record for an endpoint derived from an OpenAPI
 * document. It is deliberately metadata-only: vendor credentials, HTTP
 * dispatch, encryption, auditing, and error classification remain trusted
 * platform code instead of generated per endpoint.
 */
export interface OpenApiOperationManifest {
  source: 'openapi';
  operationId: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  parameters?: ReadonlyArray<{
    input: string;
    name: string;
    /** 'body' assembles named fields into the request body object (ideal for PATCH). */
    in: 'path' | 'query' | 'header' | 'body';
    required?: boolean;
  }>;
  body?: {
    /** If set, the named input provides the entire body. If absent, body is assembled from in:'body' parameters. */
    input?: string;
    contentType: 'application/json' | 'application/x-www-form-urlencoded';
  };
  successStatusCodes: readonly number[];
  response: { source: 'body' };
  /** Reviewed execution-scope metadata used by the package builder and runner. */
  fanout?: CapabilityFanout;
}

export interface OpenApiRequest {
  method: OpenApiOperationManifest['method'];
  path: string;
  query: URLSearchParams;
  headers: Record<string, string>;
  body?: unknown;
}

function parameterValue(value: unknown, name: string): string {
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  throw new Error(`OpenAPI parameter "${name}" must be a string, number, or boolean.`);
}

/**
 * Builds a constrained request from a reviewed manifest. It is intentionally
 * unable to choose a host, authorization header, or arbitrary path; each
 * connector supplies those trusted details.
 */
export function buildOpenApiRequest(
  operation: OpenApiOperationManifest,
  inputs: Record<string, unknown>,
): OpenApiRequest {
  let path = operation.path;
  const query = new URLSearchParams();
  const headers: Record<string, string> = {};

  const bodyFields: Record<string, unknown> = {};

  for (const parameter of operation.parameters ?? []) {
    const value = inputs[parameter.input];
    if (value === undefined || value === null) {
      if (parameter.required) throw new Error(`OpenAPI input "${parameter.input}" is required.`);
      continue;
    }
    if (parameter.in === 'path') {
      path = path.replace(`{${parameter.name}}`, encodeURIComponent(parameterValue(value, parameter.name)));
    } else if (parameter.in === 'query') {
      const values = Array.isArray(value) ? value : [value];
      for (const entry of values) query.append(parameter.name, parameterValue(entry, parameter.name));
    } else if (parameter.in === 'body') {
      // Skip empty strings for optional body fields — vendors commonly reject "" for
      // constrained string properties (e.g. Graph enforces minimum length on jobTitle).
      if (!parameter.required && value === '') continue;
      bodyFields[parameter.name] = value;
    } else {
      // Authorization is connector-owned. A manifest cannot override it.
      if (parameter.name.toLowerCase() === 'authorization') {
        throw new Error('OpenAPI manifests cannot set the Authorization header.');
      }
      headers[parameter.name] = parameterValue(value, parameter.name);
    }
  }

  if (/\{[^}]+\}/.test(path)) throw new Error(`OpenAPI path "${operation.path}" has an unresolved parameter.`);

  let body: unknown;
  if (operation.body) {
    if (operation.body.input) {
      body = inputs[operation.body.input];
    } else if (Object.keys(bodyFields).length > 0) {
      body = bodyFields;
    }
  }

  return {
    method: operation.method,
    path,
    query,
    headers,
    body,
  };
}

export type OpenApiCapability<Inputs, Outputs> = Capability<Inputs, Outputs> & {
  integration: CapabilityIntegrationRequirement;
  operation: OpenApiOperationManifest;
};

/**
 * Gives OpenAPI-derived capabilities one recognizable, type-checked shape.
 * It intentionally performs no runtime magic: an operation remains subject to
 * the same Zod contracts and handler review as a curated capability until the
 * generic vendor operation executor is introduced.
 */
export function defineOpenApiCapability<Inputs, Outputs>(
  capability: OpenApiCapability<Inputs, Outputs>,
): OpenApiCapability<Inputs, Outputs> {
  return capability;
}

/**
 * Generator-friendly authoring input. A Swagger importer or an LLM may fill
 * this structure, but generated candidates must be reviewed before being
 * converted to an executable capability with `defineOpenApiCapability`.
 */
export interface OpenApiCapabilityCandidate {
  id: string;
  integration: CapabilityIntegrationRequirement;
  vendor: string;
  name: string;
  description: string;
  category: Capability<unknown, unknown>['category'];
  operation: OpenApiOperationManifest;
  // These are emitted as source text or an intermediate representation by an
  // importer, then reviewed as Zod schemas in the executable definition.
  inputSchemaName: string;
  outputSchemaName: string;
  inputMeta: Record<string, InputMetaEntry>;
  inputGroups?: Record<string, InputGroupMeta>;
  outputMeta: Record<string, OutputMetaEntry>;
}

// Retain the Zod import in this module's public type surface. It lets generator
// implementations refer to schema-bearing candidates without duplicating the
// dependency or weakening the capability contract to `unknown`.
export type OpenApiSchemas<Inputs, Outputs> = {
  inputs: z.ZodType<Inputs>;
  outputs: z.ZodType<Outputs>;
};
