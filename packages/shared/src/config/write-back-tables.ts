/** Allowlist of vendor DB tables that catalog capabilities may write back to.
 *  Lives in @mspbyte/shared so the frontend can import it directly without a
 *  tRPC round-trip or pulling in server-only connector code. */

export interface WriteBackTableColumn {
  name: string;
  label: string;
}

export interface WriteBackTableInfo {
  schema: 'vendors';
  /** Integration ID that owns this table, e.g. 'microsoft-365'. */
  integration: string;
  /** Display label shown in the write-back UI. */
  label: string;
  allowedKeyColumns: readonly string[];
  columns: readonly WriteBackTableColumn[];
}

export const WRITE_BACK_ALLOWED_TABLES: Record<string, WriteBackTableInfo> = {
  m365_identities: {
    schema: 'vendors',
    integration: 'microsoft-365',
    label: 'Users (m365_identities)',
    allowedKeyColumns: ['external_id', 'id'],
    columns: [
      { name: 'name',                      label: 'Display name' },
      { name: 'email',                      label: 'Email / UPN' },
      { name: 'primary_email',              label: 'Primary email' },
      { name: 'type',                       label: 'User type' },
      { name: 'enabled',                    label: 'Account enabled' },
      { name: 'job_title',                  label: 'Job title' },
      { name: 'department',                 label: 'Department' },
      { name: 'company_name',               label: 'Company name' },
      { name: 'employee_id',                label: 'Employee ID' },
      { name: 'office_location',            label: 'Office location' },
      { name: 'usage_location',             label: 'Usage location' },
      { name: 'business_phone',             label: 'Business phone' },
      { name: 'mobile_phone',               label: 'Mobile phone' },
      { name: 'on_premises_sync_enabled',   label: 'On-premises sync enabled' },
      { name: 'mfa_enforced',               label: 'MFA enforced' },
      { name: 'assigned_licenses',          label: 'Assigned licenses' },
      { name: 'assigned_role_template_ids', label: 'Assigned role IDs' },
    ],
  },
  m365_groups: {
    schema: 'vendors',
    integration: 'microsoft-365',
    label: 'Groups (m365_groups)',
    allowedKeyColumns: ['external_id', 'id'],
    columns: [
      { name: 'name',             label: 'Display name' },
      { name: 'description',      label: 'Description' },
      { name: 'mail_enabled',     label: 'Mail enabled' },
      { name: 'security_enabled', label: 'Security enabled' },
    ],
  },
  m365_devices: {
    schema: 'vendors',
    integration: 'microsoft-365',
    label: 'Devices (m365_devices)',
    allowedKeyColumns: ['external_id', 'id'],
    columns: [
      { name: 'display_name',             label: 'Display name' },
      { name: 'operating_system',         label: 'OS' },
      { name: 'operating_system_version', label: 'OS version' },
      { name: 'is_compliant',             label: 'Is compliant' },
      { name: 'is_managed',               label: 'Is managed' },
      { name: 'device_ownership',         label: 'Device ownership' },
    ],
  },
  m365_policies: {
    schema: 'vendors',
    integration: 'microsoft-365',
    label: 'Conditional access policies (m365_policies)',
    allowedKeyColumns: ['external_id', 'id'],
    columns: [
      { name: 'name',         label: 'Display name' },
      { name: 'description',  label: 'Description' },
      { name: 'policy_state', label: 'State' },
    ],
  },
  halo_psa_recurring_items: {
    schema: 'vendors',
    integration: 'halopsa',
    label: 'Recurring items (halo_psa_recurring_items)',
    allowedKeyColumns: ['external_id', 'id'],
    columns: [
      { name: 'item_name',   label: 'Item name' },
      { name: 'description', label: 'Description' },
      { name: 'quantity',    label: 'Quantity' },
    ],
  },
};
