export type AgentPsaId = 'halopsa' | 'connectwise' | '';

export const AGENT_PSA_OPTIONS: { value: AgentPsaId; label: string }[] = [
  { value: '', label: 'None' },
  { value: 'halopsa', label: 'HaloPSA' },
  { value: 'connectwise', label: 'ConnectWise Manage' },
];

// Generic PSA field sources — resolved to PSA-specific IDs by the backend at bundle serve time.
export const AGENT_PSA_SOURCES: { value: string; label: string; description: string }[] = [
  { value: 'urgency', label: 'Urgency', description: 'Urgency / priority level' },
  { value: 'ticket_type', label: 'Ticket Type', description: 'Type of request or incident' },
  { value: 'category', label: 'Category', description: 'Issue category' },
  { value: 'subcategory', label: 'Subcategory', description: 'Issue subcategory' },
  { value: 'priority', label: 'Priority', description: 'Response priority' },
  { value: 'status', label: 'Status', description: 'Ticket status' },
  { value: 'team', label: 'Team', description: 'Support team' },
  { value: 'agent', label: 'Assigned Agent', description: 'Technician assigned to ticket' },
];

// Where a field value gets written in the created PSA ticket.
export const AGENT_PSA_TICKET_FIELDS: { value: string; label: string }[] = [
  { value: '', label: '— none —' },
  { value: 'summary', label: 'Ticket Summary' },
  { value: 'description', label: 'Description' },
  { value: 'name', label: 'Contact Name' },
  { value: 'email', label: 'Contact Email' },
  { value: 'phone', label: 'Contact Phone' },
];

export type AgentFieldType =
  | 'spacer'
  | 'title'
  | 'text'
  | 'textarea'
  | 'phone'
  | 'email'
  | 'number'
  | 'date'
  | 'checkbox'
  | 'select'
  | 'attachment';

// PSA metrics — what a field's submitted value can SET on the created ticket.
// isOpen=true means the value flows through directly (no enumerated PSA options to map against).
// isOpen=false means the PSA has a fixed set of valid IDs the MSP must map to.
export const AGENT_PSA_METRICS: { value: string; label: string; description: string; isOpen: boolean }[] = [
  { value: 'urgency',       label: 'Urgency',       description: 'Sets the ticket urgency level',     isOpen: false },
  { value: 'ticket_type',   label: 'Ticket Type',   description: 'Sets the ticket type',              isOpen: false },
  { value: 'priority',      label: 'Priority',      description: 'Sets the ticket priority',          isOpen: false },
  { value: 'category',      label: 'Category',      description: 'Sets the issue category',           isOpen: false },
  { value: 'subcategory',   label: 'Subcategory',   description: 'Sets the issue subcategory',        isOpen: false },
  { value: 'status',        label: 'Status',        description: 'Sets the ticket status',            isOpen: false },
  { value: 'team',          label: 'Team',          description: 'Assigns the ticket to a team',      isOpen: false },
  { value: 'agent',         label: 'Assigned Agent',description: 'Assigns the ticket to a technician',isOpen: false },
  { value: 'contact_email', label: 'Contact Email', description: 'Looks up the PSA contact by email', isOpen: true  },
  { value: 'contact_name',  label: 'Contact Name',  description: 'Contact display name',              isOpen: true  },
  { value: 'contact_phone', label: 'Contact Phone', description: 'Contact phone number',              isOpen: true  },
];

export function isOpenPsaMetric(metric: string): boolean {
  return AGENT_PSA_METRICS.find(m => m.value === metric)?.isOpen ?? true;
}

// System-provided hydration variables always available in ticket templates.
export const AGENT_SYSTEM_VARS: { key: string; label: string }[] = [
  { key: 'device_hostname', label: 'Device Hostname' },
  { key: 'os_user',         label: 'OS Username' },
  { key: 'os_display_name', label: 'OS Display Name' },
];

export interface AgentFormField {
  id: string;
  type: AgentFieldType;
  col_span: 1 | 2 | 3;
  label: string;
  required?: boolean;
  placeholder?: string;
  helpText?: string;
  // title: optional subtitle line
  subtitle?: string;
  // Template hydration — {{hydrationKey}} is substituted in ticketTitle / ticketBody
  hydrationKey?: string;
  // PSA metric this field drives (urgency, ticket_type, contact_email, etc.)
  psaMetric?: string;
  // select: per-option PSA value map { optionValue → psaValue }
  optionMappings?: Record<string, string>;
  // select: PSA-sourced options (pulled from PSA at runtime) OR manual options
  psaSource?: string;
  selectOptions?: { label: string; value: string }[];
  // legacy string[] options (backward compat)
  options?: string[];
  // attachment: what capture methods are allowed
  allowUpload?: boolean;
  allowScreenshot?: boolean;
  maxSizeMb?: number;
}

export interface AgentFormRow {
  id: string;
  cols_max: 2 | 3;
  cols: AgentFormField[];
}

// ---- Form → package automation ----

// System values the platform can supply to a package input at submit time.
// entra_* keys are only present when the submitter completed the optional
// Microsoft sign-in and the token verified server-side.
export type AgentFormSystemSourceKey =
  | 'ticket_id'
  | 'entra_upn'
  | 'entra_oid'
  | 'entra_display_name'
  | 'device_hostname'
  | 'os_user'
  | 'site_id';

export const AGENT_FORM_SYSTEM_SOURCES: { key: AgentFormSystemSourceKey; label: string; description: string }[] = [
  { key: 'ticket_id',          label: 'Created ticket ID',      description: 'The PSA ticket created by this submission' },
  { key: 'entra_upn',          label: 'Signed-in user (UPN)',   description: 'Verified Microsoft sign-in — user principal name' },
  { key: 'entra_oid',          label: 'Signed-in user (object ID)', description: 'Verified Microsoft sign-in — Entra object ID' },
  { key: 'entra_display_name', label: 'Signed-in user (name)',  description: 'Verified Microsoft sign-in — display name' },
  { key: 'device_hostname',    label: 'Device hostname',        description: 'The device the form was submitted from' },
  { key: 'os_user',            label: 'OS username',            description: 'The local user account on the device' },
  { key: 'site_id',            label: 'Site',                   description: 'The site the device belongs to' },
];

// Where a package runtime input gets its value from on submission.
export type AgentFormInputSource =
  | { kind: 'formField'; fieldId: string }
  | { kind: 'system'; key: AgentFormSystemSourceKey }
  | { kind: 'literal'; value: unknown };

// promptKey → source. Stored in agent.forms.package_bindings.
export type AgentFormPackageBindings = Record<string, AgentFormInputSource>;

const ENTRA_SOURCE_KEYS: AgentFormSystemSourceKey[] = ['entra_upn', 'entra_oid', 'entra_display_name'];

// Derived, never configured: a form asks the end user for the optional
// Microsoft sign-in exactly when its automation consumes a verified identity.
export function formWantsEntraIdentity(bindings: AgentFormPackageBindings | null | undefined): boolean {
  if (!bindings) return false;
  return Object.values(bindings).some(
    (s) => s.kind === 'system' && ENTRA_SOURCE_KEYS.includes(s.key)
  );
}

// Kept for backward-compat with forms that were saved under the old system.
export interface AgentFormPsaMapping {
  psa_field: string;
}
