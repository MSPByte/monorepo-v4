export type ProfileFieldType = 'string' | 'number' | 'boolean';
export type ProfileFieldSection = 'executive' | 'context';
export type ProfileFieldValueMode = 'single' | 'multiple';

export type ProfileFieldDef = {
  key: string;
  label: string;
  section: ProfileFieldSection;
  type: ProfileFieldType;
  valueMode: ProfileFieldValueMode;
  displayOrder: number;
  values?: string[] | null;
};

export type StackCategoryDef = {
  key: string;
  label: string;
  description: string;
  required: boolean;
  displayOrder: number;
};

export type RibbonMetricKey =
  | 'people'
  | 'workstations'
  | 'servers'
  | 'networkAssets'
  | 'totalAssets'
  | 'openFindings'
  | 'connectedIntegrations';

export const BUILT_IN_RIBBON_METRIC_KEYS: RibbonMetricKey[] = [
  'people',
  'workstations',
  'servers',
  'networkAssets',
  'totalAssets',
  'openFindings',
  'connectedIntegrations'
];

export const BUILT_IN_PROFILE_FIELDS: ProfileFieldDef[] = [
  // Executive
  {
    key: 'legal_name',
    label: 'Legal Name',
    section: 'executive',
    type: 'string',
    valueMode: 'single',
    displayOrder: 10
  },
  {
    key: 'status',
    label: 'Status',
    section: 'executive',
    type: 'string',
    valueMode: 'single',
    displayOrder: 20,
    values: ['active', 'prospect', 'former', 'internal']
  },
  {
    key: 'support_tier',
    label: 'Support Tier',
    section: 'executive',
    type: 'string',
    valueMode: 'single',
    displayOrder: 30,
    values: ['standard', 'premium', 'enterprise']
  },
  {
    key: 'industry',
    label: 'Industry',
    section: 'executive',
    type: 'string',
    valueMode: 'single',
    displayOrder: 40
  },
  {
    key: 'criticality',
    label: 'Criticality',
    section: 'executive',
    type: 'string',
    valueMode: 'single',
    displayOrder: 50,
    values: ['low', 'medium', 'high', 'critical']
  },
  {
    key: 'support_hours',
    label: 'Support Hours',
    section: 'executive',
    type: 'string',
    valueMode: 'single',
    displayOrder: 60,
    values: ['business_hours', 'extended_hours', '24x7', 'custom']
  },
  {
    key: 'time_zone',
    label: 'Time Zone',
    section: 'executive',
    type: 'string',
    valueMode: 'single',
    displayOrder: 70,
    values: Intl.supportedValuesOf('timeZone')
  },
  {
    key: 'number_of_locations',
    label: 'Locations',
    section: 'executive',
    type: 'number',
    valueMode: 'single',
    displayOrder: 80
  },
  {
    key: 'employee_count',
    label: 'Employees',
    section: 'executive',
    type: 'number',
    valueMode: 'single',
    displayOrder: 90
  },
  {
    key: 'domains',
    label: 'Domains',
    section: 'executive',
    type: 'string',
    valueMode: 'multiple',
    displayOrder: 100
  },

  // Business Context
  {
    key: 'line_of_business',
    label: 'Line of Business',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    displayOrder: 10
  },
  {
    key: 'compliance_framework',
    label: 'Compliance',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    displayOrder: 20
  },
  {
    key: 'cyber_insurance',
    label: 'Cyber Insurance',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    displayOrder: 30,
    values: ['yes', 'no', 'unknown']
  },
  {
    key: 'revenue_band',
    label: 'Revenue Band',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    displayOrder: 40,
    values: ['< $1M', '$1M-$10M', '$10M-$25M', '$25M-$100M', '$100M+']
  },
  {
    key: 'business_size',
    label: 'Business Size',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    displayOrder: 50,
    values: ['SMB', 'Mid-market', 'Enterprise']
  },
  {
    key: 'after_hours_support',
    label: 'After-Hours',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    displayOrder: 60,
    values: ['yes', 'no', 'on_call']
  },
  {
    key: 'change_approval_required',
    label: 'Change Approval',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    displayOrder: 70,
    values: ['yes', 'no', 'cab_only']
  },
  {
    key: 'change_freeze_windows',
    label: 'Freeze Windows',
    section: 'context',
    type: 'string',
    valueMode: 'single',
    displayOrder: 80
  }
];

// Categories tied to integrations we can detect are flagged required so the
// MSP must answer them even when no integration is linked.
export const BUILT_IN_STACK_CATEGORIES: StackCategoryDef[] = [
  {
    key: 'rmm',
    label: 'RMM',
    description: 'Remote monitoring & management platform',
    required: true,
    displayOrder: 10
  },
  {
    key: 'edr',
    label: 'EDR',
    description: 'Endpoint detection & response platform',
    required: true,
    displayOrder: 20
  },
  {
    key: 'identity',
    label: 'Identity',
    description: 'Identity / SSO provider',
    required: true,
    displayOrder: 30
  },
  {
    key: 'email',
    label: 'Email',
    description: 'Mailbox platform',
    required: true,
    displayOrder: 40
  },
  {
    key: 'backup',
    label: 'Backup',
    description: 'Backup platform',
    required: true,
    displayOrder: 50
  },
  {
    key: 'psa',
    label: 'PSA',
    description: 'Professional services automation / ticketing',
    required: false,
    displayOrder: 60
  },
  {
    key: 'firewall',
    label: 'Firewall',
    description: 'Network firewall vendor',
    required: false,
    displayOrder: 70
  },
  { key: 'dns', label: 'DNS', description: 'DNS provider', required: false, displayOrder: 80 },
  {
    key: 'password_manager',
    label: 'Password Mgr',
    description: 'Password management platform',
    required: false,
    displayOrder: 90
  },
  {
    key: 'remote_access',
    label: 'Remote Access',
    description: 'Remote access / VPN',
    required: false,
    displayOrder: 100
  },
  { key: 'voip', label: 'VoIP', description: 'Voice platform', required: false, displayOrder: 110 },
  {
    key: 'cloud',
    label: 'Cloud',
    description: 'Primary cloud provider',
    required: false,
    displayOrder: 120
  },
  {
    key: 'isp_primary',
    label: 'Primary ISP',
    description: 'Primary internet provider',
    required: false,
    displayOrder: 130
  },
  {
    key: 'isp_secondary',
    label: 'Secondary ISP',
    description: 'Failover internet provider',
    required: false,
    displayOrder: 140
  }
];

export const BUILT_IN_PROFILE_FIELD_KEYS = new Set(BUILT_IN_PROFILE_FIELDS.map((f) => f.key));
export const BUILT_IN_STACK_CATEGORY_KEYS = new Set(BUILT_IN_STACK_CATEGORIES.map((c) => c.key));
