import { SophosHttpClient } from './http-client.js';

const PARTNER_LICENSE_CACHE_TTL_MS = 5 * 60_000;
type PartnerLicenseCache = { data: Record<string, unknown>[]; expiresAt: number };
const partnerLicenseCache = new Map<string, PartnerLicenseCache>();
import type {
  SophosMigrationCreate,
  SophosMigrationEndpoint,
  SophosMigrationEndpointsResponse,
  SophosMigrationTrigger,
  SophosTamperProtectionGet
} from './types.js';

export interface SophosFirewallUpgradeResult {
  id?: string;
  upgradeToVersion?: string[];
}

export interface SophosTenant {
  id: string;
  name: string;
  apiHost?: string;
  status?: string;
  dataGeography?: string;
  dataRegion?: string;
}

export interface SophosTenantCreateRequest {
  name: string;
  billingType: 'trial' | 'usage' | 'ordered';
  dataGeography?: string;
  dataRegion?: string;
  contact: {
    firstName: string;
    lastName: string;
    phone: string;
    email?: string;
    mobile?: string;
    fax?: string;
    address: {
      address1: string;
      address2?: string;
      address3?: string;
      city: string;
      state?: string;
      countryCode: string;
      postalCode: string;
    };
  };
  admin?: {
    name: string;
    email: string;
    firstName?: string;
    lastName?: string;
  };
  products?: Array<{ code: string; quantity?: number }>;
  acceptedSampleSubmission?: boolean;
}

export class SophosConnector {
  private client: SophosHttpClient;
  private clientId: string;

  readonly endpoint: {
    list: (apiHost: string, tenantId?: string) => Promise<unknown[]>;
    delete: (apiHost: string, tenantId: string, endpointId: string) => Promise<void>;
    upgradeDeviceSoftware: (
      apiHost: string,
      tenantId: string,
      endpointIds: string[]
    ) => Promise<void>;
    tamperProtection: {
      get: (
        apiHost: string,
        tenantId: string,
        endpointId: string
      ) => Promise<SophosTamperProtectionGet>;
      toggle: (
        apiHost: string,
        tenantId: string,
        endpointId: string,
        enabled: boolean
      ) => Promise<void>;
    };
    migrations: {
      create: (
        apiHost: string,
        fromTenantId: string,
        toTenantId: string,
        endpointIds: string[]
      ) => Promise<SophosMigrationCreate>;
      trigger: (
        apiHost: string,
        fromTenantId: string,
        migrationId: string,
        token: string,
        endpointIds: string[]
      ) => Promise<SophosMigrationTrigger>;
      getEndpoints: (
        apiHost: string,
        tenantId: string,
        migrationId: string
      ) => Promise<SophosMigrationEndpoint[]>;
    };
  };

  readonly firewall: {
    list: (apiHost: string, tenantId?: string) => Promise<unknown[]>;
    firmwareUpgradeCheck: (
      apiHost: string,
      tenantId: string,
      firewallIds: string[]
    ) => Promise<SophosFirewallUpgradeResult[]>;
  };

  readonly license: {
    list: (tenantId?: string) => Promise<unknown[]>;
    firewalls: (tenantId?: string) => Promise<unknown[]>;
  };

  readonly partner: {
    tenants: {
      list: () => Promise<SophosTenant[]>;
      create: (req: SophosTenantCreateRequest) => Promise<SophosTenant>;
    };
  };

  constructor(clientId: string, clientSecret: string) {
    this.clientId = clientId;
    this.client = new SophosHttpClient(clientId, clientSecret);

    this.endpoint = {
      list: (apiHost, tenantId) =>
        this.client.fetchAllPages(
          `${apiHost}/endpoint/v1/endpoints?pageSize=500&pageTotal=true`,
          tenantId
        ),
      delete: (apiHost, tenantId, endpointId) =>
        this.client.delete<void>(`${apiHost}/endpoint/v1/endpoints/${endpointId}`, tenantId),
      upgradeDeviceSoftware: (apiHost, tenantId, endpointIds) =>
        this.client.patch<void>(
          `${apiHost}/endpoint/v1/settings/device-software`,
          { computer: { ids: endpointIds, protectionAssignedId: 'All' } },
          tenantId
        ),
      tamperProtection: {
        get: (apiHost, tenantId, endpointId) =>
          this.client.get<SophosTamperProtectionGet>(
            `${apiHost}/endpoint/v1/endpoints/${endpointId}/tamper-protection`,
            tenantId
          ),
        toggle: (apiHost, tenantId, endpointId, enabled) =>
          this.client.post(
            `${apiHost}/endpoint/v1/endpoints/${endpointId}/tamper-protection`,
            { enabled: enabled },
            tenantId
          )
      },
      migrations: {
        create: (apiHost, fromTenantId, toTenantId, endpointIds) =>
          this.client.post<SophosMigrationCreate>(
            `${apiHost}/endpoint/v1/migrations`,
            {
              fromTenant: fromTenantId,
              endpoints: endpointIds
            },
            toTenantId
          ),
        trigger: (apiHost, fromTenantId, migrationId, token, endpointIds) =>
          this.client.put<SophosMigrationTrigger>(
            `${apiHost}/endpoint/v1/migrations/${migrationId}`,
            {
              token,
              endpoints: endpointIds
            },
            fromTenantId
          ),
        getEndpoints: async (apiHost, tenantId, migrationId) => {
          const items: SophosMigrationEndpoint[] = [];
          let page = 1;
          while (true) {
            const result = await this.client.get<SophosMigrationEndpointsResponse>(
              `${apiHost}/endpoint/v1/migrations/${migrationId}/endpoints?page=${page}&pageTotal=true&pageSize=200`,
              tenantId
            );
            items.push(...(result.items ?? []));
            const total = result.pages?.total ?? 1;
            if (page >= total) break;
            page++;
          }
          return items;
        }
      }
    };

    this.firewall = {
      list: (apiHost, tenantId) =>
        this.client.fetchAllPages(
          `${apiHost}/firewall/v1/firewalls?pageTotal=true&pageSize=100`,
          tenantId
        ),

      firmwareUpgradeCheck: async (apiHost, tenantId, firewallIds) => {
        const result = await this.client.post<{
          firewalls?: SophosFirewallUpgradeResult[];
        }>(
          `${apiHost}/firewall/v1/firewalls/actions/firmware-upgrade-check`,
          { firewalls: firewallIds },
          tenantId
        );
        return result.firewalls ?? [];
      }
    };

    this.license = {
      list: async (tenantId) => {
        const result = await this.client.get<{ licenses?: unknown[] }>(
          'https://api.central.sophos.com/licenses/v1/licenses',
          tenantId
        );
        return result.licenses ?? [];
      },
      firewalls: (tenantId) => this.fetchPartnerLicenses('firewalls', tenantId)
    };

    this.partner = {
      tenants: {
        list: () => this.fetchPartnerTenants(),
        create: (req) => this.createPartnerTenant(req)
      }
    };
  }

  private async fetchPartnerLicenses(kind: 'firewalls', tenantId?: string): Promise<unknown[]> {
    const cached = partnerLicenseCache.get(this.clientId);
    let items: Record<string, unknown>[];

    if (cached && cached.expiresAt > Date.now()) {
      items = cached.data;
    } else {
      const whoami = await this.client.get<{
        id: string;
        idType: string;
        apiHosts?: { global?: string };
      }>('https://api.central.sophos.com/whoami/v1');

      if (whoami.idType !== 'partner' || !whoami.id) {
        throw new Error('Sophos firewall license ingestion requires a partner account');
      }

      const globalHost = whoami.apiHosts?.global ?? 'https://api.central.sophos.com';
      const partnerId = whoami.id;

      items = await this.client.fetchAllPages<Record<string, unknown>>(
        `${globalHost}/licenses/v1/licenses/firewalls?pageTotal=true&pageSize=50`,
        undefined,
        { partnerId }
      );

      partnerLicenseCache.set(this.clientId, {
        data: items,
        expiresAt: Date.now() + PARTNER_LICENSE_CACHE_TTL_MS
      });
    }

    if (!tenantId) return items;

    return items.filter(
      (item) => (item.billingTenant as { id?: string } | undefined)?.id === tenantId
    );
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.client.getToken();
      return true;
    } catch {
      return false;
    }
  }

  private async getPartnerContext(): Promise<{ partnerId: string; globalHost: string } | null> {
    const whoami = await this.client.get<{
      id: string;
      idType: string;
      apiHosts?: { global?: string };
    }>('https://api.central.sophos.com/whoami/v1');

    if (whoami.idType !== 'partner' || !whoami.id) return null;
    return {
      partnerId: whoami.id,
      globalHost: whoami.apiHosts?.global ?? 'https://api.central.sophos.com'
    };
  }

  private async createPartnerTenant(req: SophosTenantCreateRequest): Promise<SophosTenant> {
    const ctx = await this.getPartnerContext();
    if (!ctx) throw new Error('Sophos integration is not configured as a partner account');
    return this.client.post<SophosTenant>(
      `${ctx.globalHost}/partner/v1/tenants`,
      req,
      undefined,
      { partnerId: ctx.partnerId }
    );
  }

  private async fetchPartnerTenants(): Promise<SophosTenant[]> {
    const ctx = await this.getPartnerContext();
    if (!ctx) return [];
    const tenants = await this.client.fetchAllPages<SophosTenant>(
      `${ctx.globalHost}/partner/v1/tenants?pageTotal=true&pageSize=100`,
      undefined,
      { partnerId: ctx.partnerId }
    );
    tenants.sort((a, b) => a.name.localeCompare(b.name));
    return tenants;
  }
}
