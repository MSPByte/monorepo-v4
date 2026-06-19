import type { m365Policies } from '@mspbyte/drizzle';

export type PolicyConditions = {
  users?: {
    includeUsers?: string[];
    excludeUsers?: string[];
    includeGroups?: string[];
    excludeGroups?: string[];
    includeRoles?: string[];
    excludeRoles?: string[];
  };
  applications?: {
    includeApplications?: string[];
    excludeApplications?: string[];
    includeUserActions?: string[];
  };
  clientAppTypes?: string[];
  userRiskLevels?: string[];
  signInRiskLevels?: string[];
  platforms?: {
    includePlatforms?: string[];
    excludePlatforms?: string[];
  };
  locations?: {
    includeLocations?: string[];
    excludeLocations?: string[];
  };
};

export type PolicyGrantControls = {
  operator?: string;
  builtInControls?: string[];
};

export type PolicySessionControls = {
  signInFrequency?: {
    isEnabled?: boolean;
    value?: number;
    type?: string;
    frequencyInterval?: string;
  };
  persistentBrowser?: {
    isEnabled?: boolean;
    mode?: string;
  };
};

export type PolicyRow = Omit<
  typeof m365Policies.$inferSelect,
  'conditions' | 'grantControls' | 'sessionControls'
> & {
  conditions: PolicyConditions | null;
  grantControls: PolicyGrantControls | null;
  sessionControls: PolicySessionControls | null;
} & Record<string, unknown>;
