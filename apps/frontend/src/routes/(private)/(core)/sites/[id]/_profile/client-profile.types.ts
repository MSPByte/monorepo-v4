/**
 * Client Intelligence Profile — the canonical, opinionated schema for what
 * an MSP needs to know about a customer before touching anything.
 *
 * Every field carries a `source` so the UI can encode where the value came
 * from. The four classes are deliberate: prefer generated, fall back to
 * structured user entry, only then to flexible notes.
 */

export type FieldSource =
  | 'generated' // derived from connected systems
  | 'user_free' // free-form text the user typed
  | 'user_options' // user picked from a system-defined enum
  | 'user_flex'; // tribal knowledge / unstructured notes

export type Field<T = string> = {
  value: T;
  source: FieldSource;
  /** When the source = generated, the system that produced this. */
  origin?: string;
  /** When the source = generated, freshness. */
  updatedAt?: string;
};

export type Flag = {
  label: string;
  description?: string;
  source: FieldSource;
  severity?: 'info' | 'warn' | 'critical';
};

export type TribalNote = {
  category:
    | 'quirk'
    | 'procedure'
    | 'common_issue'
    | 'escalation'
    | 'deployment'
    | 'maintenance';
  body: string;
  author?: string;
  recordedAt?: string;
};

export type ContactRole =
  | 'primary'
  | 'technical'
  | 'executive'
  | 'billing'
  | 'emergency'
  | 'third_party_it';

export type Contact = {
  role: ContactRole;
  name: Field<string>;
  email?: Field<string>;
  phone?: Field<string>;
};

export type ClientProfile = {
  // Executive Summary
  legalName: Field<string | null>;
  status: Field<'active' | 'prospect' | 'former' | 'internal'>;
  supportTier: Field<'standard' | 'premium' | 'enterprise'>;
  industry: Field<string>;
  businessDescription: Field<string>;
  timeZone: Field<string>;
  primaryLocation: Field<string>;
  numberOfLocations: Field<number>;
  employeeCount: Field<number>;
  managedUsers: Field<number>;
  managedEndpoints: Field<number>;
  managedServers: Field<number>;
  managedNetworkDevices: Field<number>;
  primaryDomain: Field<string | null>;
  microsoftTenant: Field<string | null>;
  supportHours: Field<string>;
  criticality: Field<'low' | 'medium' | 'high' | 'mission_critical'>;
  lastDataSync: Field<string>;
  documentationCompleteness: Field<number>; // percent
  healthScore: Field<number>; // 0-100
  aiSummary: Field<string>;

  // Technology Stack
  stack: {
    psa: Field<string | null>;
    rmm: Field<string | null>;
    identityProvider: Field<string | null>;
    emailPlatform: Field<string | null>;
    backupPlatform: Field<string | null>;
    edrPlatform: Field<string | null>;
    firewallVendor: Field<string | null>;
    dnsProvider: Field<string | null>;
    passwordManager: Field<string | null>;
    remoteAccess: Field<string | null>;
    voipProvider: Field<string | null>;
    cloudProvider: Field<string | null>;
    primaryIsp: Field<string | null>;
    secondaryIsp: Field<string | null>;
  };

  // Infrastructure Metrics
  metrics: {
    windowsEndpoints: Field<number>;
    macEndpoints: Field<number>;
    linuxEndpoints: Field<number>;
    mobileDevices: Field<number>;
    physicalServers: Field<number>;
    virtualServers: Field<number>;
    azureVms: Field<number>;
    hypervisors: Field<number>;
    activeAlerts: Field<number>;
    failedBackups: Field<number>;
    offlineDevices: Field<number>;
    diskWarnings: Field<number>;
    expiringCertificates: Field<number>;
    expiringDomains: Field<number>;
  };

  // Business Context
  business: {
    lineOfBusiness: Field<string>;
    complianceFramework: Field<string | null>;
    cyberInsurance: Field<'yes' | 'no' | 'unknown'>;
    revenueBand: Field<string | null>;
    businessSize: Field<string>;
    afterHoursSupport: Field<'yes' | 'no' | 'on_call'>;
    changeApprovalRequired: Field<'yes' | 'no' | 'cab_only'>;
    changeFreezeWindows: Field<string | null>;
  };

  flags: Flag[];
  tribal: TribalNote[];
  contacts: Contact[];

  // Operational Metadata
  meta: {
    firstOnboarded: Field<string>;
    lastReviewed: Field<string>;
    lastManualUpdate: Field<string>;
    connectedIntegrations: Field<number>;
    missingIntegrations: Field<string[]>;
    aiSummaryRefreshedAt: Field<string>;
  };
};
