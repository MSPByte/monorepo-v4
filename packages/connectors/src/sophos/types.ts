export type SophosMigrationJobMode = 'receiving' | 'sending';

export type SophosMigrationCreate = {
  id: string;
  token: string;
  mode: SophosMigrationJobMode;
  createdAt?: string;
  createdBy?: unknown;
  expiresAt?: string;
};

export type SophosMigrationTrigger = {
  id: string;
  token?: string;
  mode: SophosMigrationJobMode;
  createdAt?: string;
  createdBy?: unknown;
  expiresAt?: string;
};

export type SophosMigrationEndpointStatus = 'pending' | 'failed' | 'succeeded';

export type SophosMigrationEndpoint = {
  id: string;
  status: SophosMigrationEndpointStatus;
  newId?: string;
  migratedAt?: string;
  failedAt?: string;
  reason?: string;
};

export type SophosMigrationEndpointsResponse = {
  items: SophosMigrationEndpoint[];
  pages?: {
    current?: number;
    size?: number;
    total?: number;
    items?: number;
    maxSize?: number;
  };
};

export type SophosTamperProtectionGet = {
  enabled: boolean;
  password: string;
  previousPasswords?:
    | Array<{
        password: string;
        invalidatedAt: string;
      }>
    | {
        password: string;
        invalidatedAt: string;
      };
};
