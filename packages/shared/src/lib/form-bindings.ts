import type {
  AgentFieldType,
  AgentFormInputSource,
  AgentFormPackageBindings,
} from '../types/agent-forms.js';

// Pure helpers connecting agent forms to package runtime inputs. Shared by
// the form builder UI, the tRPC save-time validator, and the agent backend's
// submit-time trigger so all three agree on what a valid link is.
//
// Types here are structural slices of @mspbyte/capabilities shapes (Binding,
// InputMetaEntry) — capabilities depends on shared, so the real types can't
// be imported without inverting the package graph.

type RuntimeBinding = { kind: 'runtime'; promptKey: string; required: boolean };

export type ResolvedInputMetaEntry = {
  typeHint?: string;
  entityType?: string;
  sensitive?: boolean;
  label?: string;
  description?: string;
  required?: boolean;
};

export type ResolvedInputMeta = Record<string, ResolvedInputMetaEntry>;

export type ResolveCapabilityMeta = (capabilityId: string) => ResolvedInputMeta | null;

// Structural slice of a stored package (packages.packages row or snapshot).
export type RuntimeInputPackageShape = {
  steps: unknown;
  outcomeSteps?: unknown;
  prompts?: unknown;
};

type StoredStep = {
  kind?: string;
  capabilityId: string;
  inputBindings: Record<string, { kind?: string } & Partial<RuntimeBinding>>;
};

type StoredPrompt = {
  id: string;
  label?: string;
  description?: string;
  required?: boolean;
};

export interface PackageRuntimeInput {
  promptKey: string;
  capabilityId: string;
  inputName: string;
  required: boolean;
  typeHint?: string;
  entityType?: string;
  sensitive: boolean;
  label: string;
  description?: string;
}

export interface PackageRuntimeInputCollection {
  inputs: PackageRuntimeInput[];
  // Capability ids with runtime bindings whose meta could not be resolved
  // (e.g. catalog-backed candidates the caller didn't load). Callers decide
  // whether that's an error.
  unresolvedCapabilityIds: string[];
}

// Enumerates every runtime-bound input across the main and outcome lanes,
// deduped by promptKey with prompt overrides merged over capability meta —
// the same recipe the run-package dialog uses. Sub-package steps are skipped:
// their shared inputs flow through the parent's runtimeInputs bag.
export function collectPackageRuntimeInputs(
  pkg: RuntimeInputPackageShape,
  resolveMeta: ResolveCapabilityMeta,
): PackageRuntimeInputCollection {
  const prompts = new Map(
    ((pkg.prompts as StoredPrompt[] | null) ?? []).map((p) => [p.id, p]),
  );
  const outcome = (pkg.outcomeSteps as { onSuccess?: StoredStep[]; onFailure?: StoredStep[] } | null) ?? {};
  const lanes: StoredStep[][] = [
    (pkg.steps as StoredStep[]) ?? [],
    outcome.onSuccess ?? [],
    outcome.onFailure ?? [],
  ];

  const seen = new Set<string>();
  const inputs: PackageRuntimeInput[] = [];
  const unresolved = new Set<string>();

  for (const steps of lanes) {
    for (const step of steps) {
      if (!step || step.kind === 'subpackage') continue;
      const runtimeBindings = Object.entries(step.inputBindings ?? {}).filter(
        (entry): entry is [string, RuntimeBinding] => entry[1]?.kind === 'runtime',
      );
      if (runtimeBindings.length === 0) continue;

      const meta = resolveMeta(step.capabilityId);
      if (!meta) {
        unresolved.add(step.capabilityId);
        continue;
      }

      for (const [inputName, binding] of runtimeBindings) {
        if (seen.has(binding.promptKey)) continue;
        seen.add(binding.promptKey);
        const entry = meta[inputName] ?? {};
        const prompt = prompts.get(binding.promptKey);
        inputs.push({
          promptKey: binding.promptKey,
          capabilityId: step.capabilityId,
          inputName,
          required: prompt?.required ?? binding.required,
          typeHint: entry.typeHint,
          entityType: entry.entityType,
          sensitive: entry.sensitive ?? false,
          label: prompt?.label ?? entry.label ?? binding.promptKey,
          description: prompt?.description ?? entry.description,
        });
      }
    }
  }

  return { inputs, unresolvedCapabilityIds: [...unresolved] };
}

// Which agent form field types may feed a given package input. Entity-typed
// inputs never accept free-text form fields — end users must not supply raw
// identifiers (design principle: managed inputs over raw inputs).
const FORM_FIELD_COMPAT: Record<string, AgentFieldType[]> = {
  text: ['text', 'textarea', 'select', 'email', 'phone'],
  upn: ['email', 'text', 'select'],
  number: ['number', 'select'],
  date: ['date', 'text'],
  datetime: ['date', 'text'],
  boolean: ['checkbox'],
  city: ['text', 'select'],
  state: ['text', 'select'],
  countryCode: ['text', 'select'],
  postalCode: ['text', 'number'],
};

export function formFieldTypesForInput(
  input: Pick<PackageRuntimeInput, 'typeHint' | 'entityType'>,
): AgentFieldType[] {
  if (input.entityType) return [];
  return FORM_FIELD_COMPAT[input.typeHint ?? 'text'] ?? [];
}

export interface FormBindingValidationArgs {
  collection: PackageRuntimeInputCollection;
  bindings: AgentFormPackageBindings;
  // fieldId → field type, for every non-decorative field on the form.
  formFieldTypes: Record<string, AgentFieldType>;
}

// Save-time validation for a form → package link. Returns human-readable
// errors; an empty array means the link is complete and safe to store.
export function validateFormPackageBindings({
  collection,
  bindings,
  formFieldTypes,
}: FormBindingValidationArgs): string[] {
  const errors: string[] = [];

  if (collection.unresolvedCapabilityIds.length > 0) {
    errors.push(
      `Package uses capabilities that cannot be linked to forms: ${collection.unresolvedCapabilityIds.join(', ')}`,
    );
  }

  const byKey = new Map(collection.inputs.map((i) => [i.promptKey, i]));

  for (const promptKey of Object.keys(bindings)) {
    if (!byKey.has(promptKey)) {
      errors.push(`Binding references unknown package input "${promptKey}"`);
    }
  }

  for (const input of collection.inputs) {
    const source: AgentFormInputSource | undefined = bindings[input.promptKey];

    if (input.sensitive || input.typeHint === 'password') {
      if (source) {
        errors.push(`"${input.label}" is a sensitive input and cannot be filled from a form submission`);
      } else if (input.required) {
        errors.push(`"${input.label}" is a required sensitive input — this package cannot be triggered from a form`);
      }
      continue;
    }

    if (!source) {
      if (input.required) errors.push(`Required package input "${input.label}" has no value source`);
      continue;
    }

    if (source.kind === 'formField') {
      if (input.entityType) {
        errors.push(`"${input.label}" expects a managed ${input.entityType} value and cannot come from a form field`);
        continue;
      }
      const fieldType = formFieldTypes[source.fieldId];
      if (!fieldType) {
        errors.push(`"${input.label}" is mapped to a form field that no longer exists`);
        continue;
      }
      const compat = formFieldTypesForInput(input);
      if (!compat.includes(fieldType)) {
        errors.push(`"${input.label}" cannot be filled from a ${fieldType} field`);
      }
    } else if (
      source.kind === 'literal'
      && input.required
      && (source.value === undefined || source.value === null || (typeof source.value === 'string' && source.value.trim() === ''))
    ) {
      errors.push(`Required package input "${input.label}" has an empty fixed value`);
    }
    // system and literal sources are accepted for any non-sensitive input:
    // system values are platform-verified, literals are MSP-authored.
  }

  return errors;
}
