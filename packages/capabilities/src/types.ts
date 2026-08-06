import type { z } from 'zod';
import type { M365Connector } from '@mspbyte/connectors';
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
  | { kind: 'priorOutput'; stepPosition: number; path: string };

export type BindingKind = Binding['kind'];

export type CapabilityResult<Outputs> =
  | { outcome: 'success'; outputs: Outputs }
  | { outcome: 'skip'; reason: string }
  | { outcome: 'fail'; errorClass: string; message: string; retryable?: boolean };

// Hint the runtime input form renderer. Sensitive fields auto-render as
// password inputs regardless of typeHint. Server-side zod is still the
// authority — this is UI-only.
export type InputTypeHint = 'text' | 'boolean' | 'stringArray';

export interface InputMetaEntry {
  allowedBindings: ReadonlyArray<BindingKind>;
  entityType?: string;
  sensitive?: boolean;
  priorOutputCompat?: readonly string[];
  typeHint?: InputTypeHint;
}

export interface OutputMetaEntry {
  sensitive?: boolean;
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
  loadM365Identity: (identityId: string) => Promise<M365IdentityRow | null>;
  getM365Connector: (linkId: string) => Promise<M365Connector>;
}

export interface Capability<Inputs = unknown, Outputs = unknown> {
  id: string;
  vendor: string;
  name: string;
  description: string;
  category: 'identity' | 'license' | 'group' | 'role' | 'device' | 'admin';
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

export type AnyCapability = Capability<any, any>;
