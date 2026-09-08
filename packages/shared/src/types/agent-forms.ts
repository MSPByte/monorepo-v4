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
  | 'checkbox'
  | 'select'
  | 'attachment';

// PSA metrics — what a field's submitted value can SET on the created ticket.
// The backend maps these to PSA-specific API parameters based on primaryPsa.
export const AGENT_PSA_METRICS: { value: string; label: string; description: string }[] = [
  { value: 'urgency',       label: 'Urgency',       description: 'Sets the ticket urgency level' },
  { value: 'ticket_type',   label: 'Ticket Type',   description: 'Sets the ticket type' },
  { value: 'priority',      label: 'Priority',      description: 'Sets the ticket priority' },
  { value: 'category',      label: 'Category',      description: 'Sets the issue category' },
  { value: 'subcategory',   label: 'Subcategory',   description: 'Sets the issue subcategory' },
  { value: 'contact_email', label: 'Contact Email', description: 'Looks up the PSA contact by email' },
  { value: 'contact_name',  label: 'Contact Name',  description: 'Contact display name' },
  { value: 'contact_phone', label: 'Contact Phone', description: 'Contact phone number' },
];

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

// Kept for backward-compat with forms that were saved under the old system.
export interface AgentFormPsaMapping {
  psa_field: string;
}
