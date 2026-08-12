import type { z } from 'zod';
import type { M365Connector, SophosConnector, DattoConnector, CoveConnector } from '@mspbyte/connectors';
import type { ActionLabels } from '@mspbyte/shared';

// Tagged union describing how a step's input value is produced at run time.
// Persisted verbatim in packages.package_steps.input_bindings and inside the
// packageSnapshot on each package_run.
export type Binding =
  | { kind: 'literal'; value: unknown }
  | { kind: 'runtime'; promptKey: string; required: boolean }
  | {
      kind: 'entity';
      source: 'row-context' | 'picker';
      entityType: string;
      pickerConfig?: { multi?: boolean; filter?: Record<string, unknown> };
      contextKey?: string;
    }
  | { kind: 'priorOutput'; stepPosition: number; path: string }
  // `generator` names a registered entry in the generators registry
  // (see ./generators). Params are validated per-generator at resolve time.
  | { kind: 'generated'; generator: string; params: Record<string, unknown> }
  // Reads a value from the run's site's `site_profile_facts` at run time.
  // Requires the run to have a siteId. `required` mirrors the runtime kind:
  // when false, an absent/unapplicable fact resolves to undefined.
  | { kind: 'siteFact'; key: string; required: boolean };

export type BindingKind = Binding['kind'];

// Curated error taxonomy — capabilities and the worker map their failure modes
// into this set so packages can decide onFailure behavior per class (e.g. treat
// `already_exists` as continue-worthy while `permission_denied` should halt).
export const ERROR_CLASSES = [
  'not_found',
  'already_exists',
  'invalid_input',
  'permission_denied',
  'rate_limited',
  'transient',
  'vendor_error',
  'binding_unresolved',
  'expired_outputs',
  'capability_missing',
  'input_validation',
  'handler_threw',
  'canceled',
] as const;

export type ErrorClass = (typeof ERROR_CLASSES)[number];

// Which classes are safe to retry on their own (worker-driven attempts) vs.
// only useful to retry manually. Used by the retry-attempts logic.
export const RETRYABLE_ERROR_CLASSES: readonly ErrorClass[] = [
  'transient',
  'rate_limited',
  'vendor_error',
];

export type CapabilityResult<Outputs> =
  | { outcome: 'success'; outputs: Outputs }
  | { outcome: 'skip'; reason: string }
  | { outcome: 'fail'; errorClass: ErrorClass; message: string; retryable?: boolean };

// Hint the runtime input form renderer. Sensitive fields auto-render as
// password inputs regardless of typeHint. Server-side zod is still the
// authority — this is UI-only.
export type InputTypeHint = 'text' | 'boolean' | 'stringArray' | 'number' | 'password' | 'upn';

export interface InputMetaEntry {
  allowedBindings: ReadonlyArray<BindingKind>;
  entityType?: string;
  sensitive?: boolean;
  priorOutputCompat?: readonly string[];
  typeHint?: InputTypeHint;
  // Human-facing label. Defaults to the key name in the UI when omitted.
  label?: string;
  // One-line help text rendered under the field.
  description?: string;
  // If false, the input is optional — the form hides it under an "Advanced"
  // toggle and the handler receives undefined when it's not supplied. Default
  // true so existing capability meta stays backwards-compatible.
  required?: boolean;
  // When true, the field is optional AND collapsed by default in the form.
  // Requires required === false; ignored otherwise.
  advanced?: boolean;
  // Baked-in default for literal bindings when no value is provided.
  defaultValue?: unknown;
  // For typeHint === 'text' with a closed set of choices.
  choices?: ReadonlyArray<{ value: string; label: string }>;
}

export interface OutputMetaEntry {
  sensitive?: boolean;
  label?: string;
  description?: string;
  // Semantic type identifier used by the package builder UI to filter compatible
  // priorOutput wires. Inputs declare which outputTypes they accept via priorOutputCompat.
  outputType?: string;
}

// Row shape the worker resolves for Sophos endpoint capabilities.
export interface SophosEndpointRow {
  id: string;
  linkId: string;
  siteId: string | null;
  externalId: string;
  hostname: string;
  tamperProtectionEnabled: boolean | null;
  tenantId: string | null;
  apiHost: string | null;
}

// Options for creating an integration link inside a capability handler.
export interface CreateIntegrationLinkOpts {
  siteId: string;
  integrationId: string;
  externalId: string;
  name: string;
  status?: 'active' | 'error' | 'disabled';
  meta?: Record<string, unknown>;
}

// Row shape the worker resolves for identity-scoped capabilities. Mirrors the
// select in loadM365IdentityRows (packages/trpc/src/routers/vendor.ts:260).
export interface M365IdentityRow {
  id: string;
  linkId: string;
  siteId: string | null;
  externalId: string;
  name: string;
  email: string;
  enabled: boolean;
  tenantId: string | null;
  tenantName: string | null;
  integrationConfig: unknown;
}

// The worker constructs CapabilityCtx per step invocation. Members are
// callback-shaped so capabilities never take a direct dependency on Drizzle,
// BullMQ, or the tenant DB — everything the handler needs is injected.
export interface CapabilityCtx {
  encryptionKey: string;
  user: { id: string; name?: string | null; email?: string | null };
  ipAddress?: string | null;
  userAgent?: string | null;
  packageRunId: string;
  packageRunStepId: string;
  // Names of inputs whose values were produced by a `generated` binding.
  // Handlers use this to decide whether to echo the value back (e.g. return
  // a generated password so the operator can retrieve it) vs. keep silent
  // for user-supplied values.
  generatedInputs: ReadonlySet<string>;
  // Facts for the run's site (empty map when the run has no siteId). The
  // worker resolves this once per run so multiple siteFact bindings share
  // the read; individual capabilities rarely need to call this directly —
  // the binding resolver does it for them.
  siteFacts: ReadonlyMap<string, unknown>;
  loadM365Identity: (identityId: string) => Promise<M365IdentityRow | null>;
  getM365Connector: (linkId: string) => Promise<M365Connector>;
  // Loads a Sophos endpoint row (with resolved tenantId / apiHost) from the DB.
  loadSophosEndpoint: (endpointId: string) => Promise<SophosEndpointRow | null>;
  // Returns a SophosConnector for a specific site-level integration link.
  // Used by endpoint capabilities where the link is resolved from the endpoint row.
  getSophosConnector: (linkId: string) => Promise<SophosConnector>;
  // Returns a SophosConnector for the Sophos Partner integration (loaded by integration ID,
  // no link selection needed). Used by site-creation capabilities.
  getSophosPartnerConnector: () => Promise<SophosConnector>;
  // Returns a DattoConnector for the Datto RMM integration (loaded by integration ID).
  getDattoConnector: () => Promise<DattoConnector>;
  // Returns a CoveConnector for the Cove integration (loaded by integration ID) plus
  // the root partner ID read from the root integration link (siteId IS NULL).
  getCoveConnector: () => Promise<{ connector: CoveConnector; rootPartnerId: number }>;
  // Looks up a MSPByte site by id. Returns null if not found.
  lookupSite: (siteId: string) => Promise<{ id: string; name: string } | null>;
  // Creates a new MSPByte internal site. Returns the site id and name.
  createSite: (name: string, description?: string) => Promise<{ id: string; name: string }>;
  // Creates an integration link connecting a MSPByte site to a vendor account.
  createIntegrationLink: (opts: CreateIntegrationLinkOpts) => Promise<{ id: string }>;
}

export interface Capability<Inputs = unknown, Outputs = unknown> {
  id: string;
  vendor: string;
  name: string;
  description: string;
  category: 'identity' | 'license' | 'group' | 'role' | 'device' | 'admin' | 'site';
  inputs: z.ZodType<Inputs>;
  outputs: z.ZodType<Outputs>;
  inputMeta: Record<string, InputMetaEntry>;
  outputMeta: Record<string, OutputMetaEntry>;
  actionLabel: ActionLabels;
  // Maps to audit.customer_logs.action enum: 'create' | 'update' | 'delete'.
  auditAction: 'create' | 'update' | 'delete';
  requiredPermission: string;
  defaultUnitPrice: number;
  handler: (ctx: CapabilityCtx, inputs: Inputs) => Promise<CapabilityResult<Outputs>>;
}

// Package-level failure notification config. Executed by the worker when a run
// reaches a terminal failed/halted/partial state. Email + PSA are stubbed for
// now — the worker just logs the intent so the plumbing is in place.
export type FailureAction =
  | { kind: 'log' }
  | { kind: 'email'; to: readonly string[]; subject?: string }
  | { kind: 'psa_ticket'; boardId?: string; priority?: 'low' | 'normal' | 'high' };

// Per-step overrides captured alongside inputBindings. The worker uses these
// to decide whether a step failure halts the run and how aggressively to
// retry a transient error before giving up.
export type StepOnFailure = 'halt' | 'continue';

export interface StepConfig {
  onFailure?: StepOnFailure;
  // Worker attempts count for retryable errors (RETRYABLE_ERROR_CLASSES).
  // Non-retryable classes ignore this entirely. Clamped 0-5.
  retryAttempts?: number;
}

export type AnyCapability = Capability<any, any>;
