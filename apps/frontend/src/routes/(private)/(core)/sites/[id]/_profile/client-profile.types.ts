export type FieldSource = 'generated' | 'user_options' | 'user_free' | 'user_flex';

export type FactApplicable = 'applies' | 'not_applicable' | 'unknown';
export type FactConfidence = 'high' | 'medium' | 'low' | null;
export type FactValue = string | number | boolean | string[] | null;

export type ProfileFact = {
  key: string;
  label: string;
  category: 'executive' | 'context' | string;
  value: FactValue;
  valueMode: 'single' | 'multiple';
  source: FieldSource;
  origin: string | null;
  confidence: FactConfidence;
  applicable: FactApplicable;
  updatedAt: string | null;
};

export type ProfileMetric = {
  key: string;
  label: string;
  value: number | string | null;
  source: 'generated';
  origin: string;
  supported: boolean;
};

export type StackEntry = {
  categoryKey: string;
  categoryLabel: string;
  required: boolean;
  vendor: string | null;
  product: string | null;
  status: 'managed' | 'third_party' | 'not_used' | 'unknown';
  source: 'generated' | 'manual';
  origin: string | null;
};

export type ProfileNote = {
  id: string;
  type: 'special' | 'tribal';
  title: string;
  description: string;
  severity: number | null;
  active: boolean;
  updatedAt: string;
};

export type ProfileContact = {
  role: string;
  name: string;
  email: string | null;
  phone: string | null;
  source: FieldSource;
  origin: string | null;
};

export type ProfileIntegration = {
  id: string;
  integrationId: string;
  name: string | null;
  status: string | null;
  disposition: string | null;
};

export type NetworkAsset = {
  id: string;
  displayName: string;
  hostname: string | null;
  assetType: string;
  status: string;
  sources: string[];
};

export type NetworkFirewall = {
  id: string;
  name: string;
  hostname: string;
  model: string;
  serialNumber: string;
  firmwareVersion: string;
  externalIp: string;
  connected: boolean;
  suspended: boolean;
  managing: string;
  reporting: string;
  upgradeToVersion: string | null;
  lastSeenAt: string;
  origin: 'sophos-partner';
};

export type SiteProfileResponse = {
  site: {
    id: string;
    name: string;
    description: string | null;
    parentSiteId: string | null;
    createdAt: string;
    updatedAt: string;
  };
  facts: ProfileFact[];
  metrics: ProfileMetric[];
  stack: StackEntry[];
  notes: ProfileNote[];
  contacts: ProfileContact[];
  integrations: ProfileIntegration[];
  network: {
    assets: NetworkAsset[];
    firewalls: NetworkFirewall[];
  };
  completeness: {
    value: number;
    applicableCount: number;
    completeCount: number;
  };
};
