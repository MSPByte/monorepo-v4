import type { z } from 'zod';
import type { M365Connector, SophosConnector, DattoConnector, CoveConnector, HaloPSAConnector } from '@mspbyte/connectors';
import type { ActionLabels } from '@mspbyte/shared';
import type { FieldTypeId as PackageFieldTypeId } from '@mspbyte/shared';

// Stable, deliberately small data contract exposed only to failure reactions.
// Unlike main-step outputs, every field here exists whenever the failure lane
// runs, so responders can safely describe what went wrong.
export const FAILURE_CONTEXT_PATHS = [
  'runId',
  'status',
  'siteId',
  'stepPosition',
  'capabilityId',
  'capabilityName',
  'errorClass',
  'message',
] as const;
export type FailureContextPath = (typeof FAILURE_CONTEXT_PATHS)[number];

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
  | {
      kind: 'priorOutput';
      stepPosition: number;
      path: string;
      // Terminal reactions can read from the completed main path or a prior
      // reaction in their own lane. Omitted remains `main` for old packages.
      lane?: 'main' | 'onSuccess' | 'onFailure';
    }
  | { kind: 'failureContext'; path: FailureContextPath }
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
export type InputTypeHint =
  | 'text'
  | 'boolean'
  | 'stringArray'
  | 'number'
  | 'password'
  | 'upn'
  // Address-aware hints: postalCode triggers autofill; city/countryCode/state are targets.
  | 'postalCode'
  | 'city'
  | 'countryCode'
  | 'state';

export interface InputMetaEntry {
  allowedBindings: ReadonlyArray<BindingKind>;
  // Canonical package type. When omitted, existing entityType/typeHint values
  // resolve through the package field-type registry for backwards compatibility.
  valueType?: PackageFieldTypeId;
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
  // Key for dynamic option lists fetched at run time by the run dialog.
  // Supported values: 'coveChildPartners'
  dynamicSource?: string;
  // Presentation-only grouping used by the package builder and run dialog.
  // The runtime contract stays flat so existing capability handlers remain
  // backwards compatible while authors see the shape of the vendor object.
  group?: string;
  order?: number;
  // Show this input only when a controlling input has the declared value.
  // This is a UI affordance, not a substitute for handler-side validation.
  visibleWhen?: { input: string; equals: unknown };
}

export interface InputGroupMeta {
  label: string;
  description?: string;
  order?: number;
  advanced?: boolean;
}

export interface OutputMetaEntry {
  sensitive?: boolean;
  label?: string;
  description?: string;
  // Semantic type identifier used by the package builder UI to filter compatible
  // priorOutput wires. Inputs declare which outputTypes they accept via priorOutputCompat.
  outputType?: string;
  // Canonical package type. outputType remains the stable wire-compatibility
  // identifier used by existing packages.
  valueType?: PackageFieldTypeId;
}

// Declares the connection a capability needs before it can be offered to a
// package author. This is intentionally independent of `vendor`, which is a
// presentation label retained for the existing catalog UI.
//
// `configured` is for integrations with tenant-wide credentials (Datto, Cove,
// global HaloPSA operations). `activeLink` is for integrations whose actions
// require at least one usable tenant/site link (for example Microsoft 365).
export interface CapabilityIntegrationRequirement {
  integrationId: string;
  connection: 'configured' | 'activeLink';
}

/**
 * Defines how a capability participates when a package is launched against a
 * table selection. `per_target` supplies the package's one collection axis;
 * `inherited` is safe to execute once for each selected target; `single_run`
 * deliberately prevents table/batch execution.
 */
export type CapabilityFanout =
  | { mode: 'per_target'; targetInput: string }
  | { mode: 'inherited' }
  | { mode: 'single_run' };

export interface CapabilityAvailabilityInventory {
  configuredIntegrationIds: ReadonlySet<string>;
  activeLinkIntegrationIds: ReadonlySet<string>;
}

// Row shape the worker resolves for Sophos endpoint capabilities.
export interface SophosEndpointRow {
  id: string;
  linkId: string;
  siteId: string | null;
  externalId: string;
  hostname: string;
  needsUpgrade: boolean;
  tamperProtectionEnabled: boolean | null;
  tenantId: string | null;
  apiHost: string | null;
}

export interface UpsertM365GroupData {
  linkId: string;
  externalId: string;
  name: string;
  description?: string;
  mailEnabled: boolean;
  securityEnabled: boolean;
}

export interface UpsertM365IdentityData {
  linkId: string;
  externalId: string;
  name: string;
  email: string;
  enabled?: boolean;
  type?: 'member' | 'guest' | 'service';
}

export interface UpsertM365PolicyData {
  linkId: string;
  externalId: string;
  name: string;
  policyState: 'enabled' | 'disabled' | 'enabledForReportingButNotEnforced';
  conditions?: unknown;
  grantControls?: unknown;
  sessionControls?: unknown;
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
  // Records a completed software upgrade immediately, without waiting for ingestion.
  markSophosEndpointsUpgraded: (endpointIds: string[]) => Promise<void>;
  // Returns a SophosConnector for the Sophos Partner integration (loaded by integration ID,
  // no link selection needed). Used by site-creation capabilities.
  getSophosPartnerConnector: () => Promise<SophosConnector>;
  // Returns a DattoConnector for the Datto RMM integration (loaded by integration ID).
  getDattoConnector: () => Promise<DattoConnector>;
  // Returns a CoveConnector for the Cove integration (loaded by integration ID) plus
  // the root partner ID read from the root integration link (siteId IS NULL).
  getCoveConnector: () => Promise<{ connector: CoveConnector; rootPartnerId: number }>;
  // Returns the HaloPSA connector and the Halo site linked to the package run's
  // MSPByte site. This capability context deliberately resolves the site link
  // instead of asking package authors to manage Halo IDs.
  getHaloPSAConnector: () => Promise<{ connector: HaloPSAConnector; haloSiteId: number }>;
  // Tenant-wide HaloPSA connector — for capabilities that operate on Halo
  // resources by ID (a ticket, an asset, an action) and don't need a Halo
  // site link. Available on every run regardless of run.siteId.
  getHaloPSAConnectorGlobal: () => Promise<HaloPSAConnector>;
  // Looks up a MSPByte site by id. Returns null if not found.
  lookupSite: (siteId: string) => Promise<{ id: string; name: string } | null>;
  // Creates a new MSPByte internal site. Returns the site id and name.
  createSite: (name: string, description?: string) => Promise<{ id: string; name: string }>;
  // Creates an integration link connecting a MSPByte site to a vendor account.
  createIntegrationLink: (opts: CreateIntegrationLinkOpts) => Promise<{ id: string }>;
  // Write-through helpers: persist a vendor resource to the DB immediately after
  // creation so downstream steps and the UI see it without waiting for a sync.
  // All three are best-effort — a DB failure does not fail the step.
  upsertM365Group: (data: UpsertM365GroupData) => Promise<{ id: string }>;
  upsertM365Identity: (data: UpsertM365IdentityData) => Promise<{ id: string }>;
  upsertM365Policy: (data: UpsertM365PolicyData) => Promise<{ id: string }>;
}

export interface Capability<Inputs = unknown, Outputs = unknown> {
  id: string;
  // Kept executable for existing package snapshots, but omitted from the
  // authoring catalog. Use only for narrow compatibility bridges.
  hidden?: boolean;
  vendor: string;
  integration?: CapabilityIntegrationRequirement;
  // Present for endpoint-level capabilities derived from a reviewed OpenAPI
  // operation. Curated capabilities intentionally omit this.
  operation?: import('./openapi.js').OpenApiOperationManifest;
  name: string;
  description: string;
  category: 'identity' | 'license' | 'group' | 'role' | 'device' | 'admin' | 'site';
  inputs: z.ZodType<Inputs>;
  outputs: z.ZodType<Outputs>;
  inputMeta: Record<string, InputMetaEntry>;
  // Named sections that make a complex capability read like the product it
  // drives (for example, Entra Conditional Access), rather than a flat API.
  inputGroups?: Record<string, InputGroupMeta>;
  outputMeta: Record<string, OutputMetaEntry>;
  /** Explicit batch-execution contract. Omit only while authoring legacy code capabilities. */
  fanout?: CapabilityFanout;
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

export function isCapabilityAvailable(
  capability: AnyCapability,
  inventory: CapabilityAvailabilityInventory,
): boolean {
  const requirement = capability.integration;
  if (!requirement) return true;
  if (!inventory.configuredIntegrationIds.has(requirement.integrationId)) return false;
  return requirement.connection !== 'activeLink'
    || inventory.activeLinkIntegrationIds.has(requirement.integrationId);
}
