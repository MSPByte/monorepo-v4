import { M365GraphClient } from './graph-client.js';

export interface DelegatedAdminRelationship {
  id: string;
  status: string;
  customer: { tenantId: string; displayName?: string } | null;
}

export class M365Connector {
  private readonly clientId: string;
  private client: M365GraphClient;

  clearTokenCache() {
    this.client.clearCache();
  }

  readonly users: {
    listAll: (select: string) => Promise<unknown[]>;
    delta: (select: string, cursor?: string) => Promise<{ items: unknown[]; cursor?: string }>;
    listForInboxRules: () => Promise<Array<{ userPrincipalName: string; accountEnabled: boolean }>>;
    authMethods: (userId: string) => Promise<{ value: Array<Record<string, unknown>> }>;
  };

  readonly groups: {
    listAll: (select: string) => Promise<unknown[]>;
    members: (groupId: string) => Promise<Array<{ id?: string }>>;
  };

  readonly directoryRoles: {
    members: (roleTemplateId: string) => Promise<Array<{ id?: string }>>;
  };

  readonly subscribedSkus: {
    listAll: () => Promise<unknown[]>;
  };

  readonly conditionalAccess: {
    policies: () => Promise<unknown[]>;
  };

  readonly devices: {
    listAll: (select: string) => Promise<unknown[]>;
  };

  readonly oauthGrants: {
    listAll: () => Promise<unknown[]>;
  };

  readonly directoryObjects: {
    getByIds: (
      ids: string[],
      types: string[]
    ) => Promise<Array<{ id: string; displayName?: string }>>;
  };

  readonly identityProtection: {
    // 403 = missing P2 license — callers handle this and log appropriately
    riskyUsers: (filter: string) => Promise<unknown[]>;
  };

  readonly tenantRelationships: {
    delegatedAdminRelationships: {
      listAll: () => Promise<DelegatedAdminRelationship[]>;
    };
  };

  readonly organization: {
    get: () => Promise<{ id: string; displayName: string }>;
  };

  readonly domains: {
    listAll: () => Promise<Array<{ id: string; isVerified: boolean; isDefault: boolean }>>;
  };

  readonly servicePrincipals: {
    findOwn: () => Promise<{ id: string } | null>;
  };

  readonly roleManagement: {
    directory: {
      roleAssignments: {
        // 409 Conflict (already assigned) is silently treated as success
        create: (principalId: string, roleDefinitionId: string) => Promise<void>;
      };
    };
  };

  constructor(clientId: string, clientSecret: string, tenantId: string) {
    this.clientId = clientId;
    this.client = new M365GraphClient(clientId, clientSecret, tenantId);

    this.users = {
      listAll: (select) =>
        this.client.getAll(`https://graph.microsoft.com/v1.0/users?$select=${select}`),

      delta: (select, cursor) =>
        this.client.getDelta(
          `https://graph.microsoft.com/v1.0/users/delta?$select=${select}`,
          cursor
        ),

      listForInboxRules: () =>
        this.client.getAll<{ userPrincipalName: string; accountEnabled: boolean }>(
          'https://graph.microsoft.com/v1.0/users?$select=userPrincipalName,accountEnabled'
        ),

      authMethods: (userId) =>
        this.client
          .get<{
            value: Array<Record<string, unknown>>;
          }>(`https://graph.microsoft.com/v1.0/users/${userId}/authentication/methods`)
          .then((r) => r.data)
    };

    this.groups = {
      listAll: (select) =>
        this.client.getAll(`https://graph.microsoft.com/v1.0/groups?$select=${select}`),

      members: (groupId) =>
        this.client.getAll<{ id?: string }>(
          `https://graph.microsoft.com/v1.0/groups/${groupId}/members?$select=id`
        )
    };

    this.directoryRoles = {
      // 404 means the role template has never been activated in this tenant — return [] silently
      members: (roleTemplateId) =>
        this.client.getAll<{ id?: string }>(
          `https://graph.microsoft.com/v1.0/directoryRoles(roleTemplateId='${roleTemplateId}')/members?$select=id`,
          { ignoreStatuses: [404] }
        )
    };

    this.subscribedSkus = {
      listAll: () =>
        this.client.getAll(
          'https://graph.microsoft.com/v1.0/subscribedSkus?$select=skuId,skuPartNumber,capabilityStatus,consumedUnits,prepaidUnits,servicePlans'
        )
    };

    this.conditionalAccess = {
      policies: () =>
        this.client.getAll('https://graph.microsoft.com/v1.0/identity/conditionalAccess/policies')
    };

    this.devices = {
      listAll: (select) =>
        this.client.getAll(`https://graph.microsoft.com/v1.0/devices?$select=${select}`)
    };

    this.oauthGrants = {
      listAll: () => this.client.getAll('https://graph.microsoft.com/v1.0/oauth2PermissionGrants')
    };

    this.directoryObjects = {
      getByIds: (ids, types) =>
        this.client
          .post<{
            value: Array<{ id: string; displayName?: string }>;
          }>('https://graph.microsoft.com/v1.0/directoryObjects/getByIds', { ids, types })
          .then((r) => r.data.value)
    };

    this.identityProtection = {
      riskyUsers: (filter) =>
        this.client.getAll(
          `https://graph.microsoft.com/v1.0/identityProtection/riskyUsers?$filter=${filter}`
        )
    };

    this.tenantRelationships = {
      delegatedAdminRelationships: {
        listAll: () =>
          this.client.getAll<DelegatedAdminRelationship>(
            'https://graph.microsoft.com/v1.0/tenantRelationships/delegatedAdminRelationships'
          )
      }
    };

    this.organization = {
      get: async () => {
        const { data } = await this.client.get<{
          value: Array<{ id: string; displayName: string }>;
        }>('https://graph.microsoft.com/v1.0/organization?$select=id,displayName');
        const org = data.value[0];
        if (!org) throw new Error('No organization found');
        return org;
      }
    };

    this.domains = {
      listAll: () =>
        this.client.getAll<{ id: string; isVerified: boolean; isDefault: boolean }>(
          'https://graph.microsoft.com/v1.0/domains?$select=id,isVerified,isDefault'
        )
    };

    this.servicePrincipals = {
      findOwn: async () => {
        const { data } = await this.client.get<{ value: Array<{ id: string }> }>(
          `https://graph.microsoft.com/v1.0/servicePrincipals?$filter=appId eq '${this.clientId}'&$select=id`
        );
        return data.value[0] ?? null;
      }
    };

    this.roleManagement = {
      directory: {
        roleAssignments: {
          create: async (principalId, roleDefinitionId) => {
            try {
              await this.client.post(
                'https://graph.microsoft.com/v1.0/roleManagement/directory/roleAssignments',
                { principalId, roleDefinitionId, directoryScopeId: '/' }
              );
            } catch (err) {
              if (
                err instanceof Error &&
                err.message.includes(
                  'A conflicting object with one or more of the specified property values'
                )
              )
                return;
              throw err;
            }
          }
        }
      }
    };
  }
}
