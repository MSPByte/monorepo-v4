import {
  M365Connector,
  SkuCatalogService,
  TenantCapabilityService,
} from "@mspbyte/connectors";
import {
  CAPABILITY_PLANS,
  M365_BLOAT_LICENSES,
  type MSGraphCapabilities,
} from "@mspbyte/shared/config/integrations/microsoft-365";
import { getM365RawSchema, PROVIDER_IDS, ProviderFacet } from "@mspbyte/shared";
import type {
  FetchPage,
  FetchResultCursor,
  IngestionAdapter,
  IngestionAdapterContext,
  RawRecordEnvelope,
  SyncMode,
} from "@mspbyte/pipeline";
import { requireMicrosoftCredentials } from "../../env.js";
import { logger } from "../../logger.js";
import { serializeError } from "../../errors.js";

const M365_IDENTITY_BASE_FIELDS = [
  "id",
  "displayName",
  "userType",
  "userPrincipalName",
  "accountEnabled",
  "assignedLicenses",
];
const M365_IDENTITY_DELTA_FIELDS = [
  "id",
  "displayName",
  "userType",
  "userPrincipalName",
  "accountEnabled",
].join(",");

export const m365Adapter: IngestionAdapter = {
  providerId: PROVIDER_IDS.M365,
  types: [
    ProviderFacet.M365Identities,
    ProviderFacet.M365Groups,
    ProviderFacet.M365Licenses,
    ProviderFacet.M365CAPolicies,
    ProviderFacet.M365AuthMethods,
    ProviderFacet.M365Devices,
    ProviderFacet.M365OAuthGrants,
    ProviderFacet.M365RiskyUsers,
  ],

  async *fetch(
    type,
    mode,
    cursor,
    context,
  ): AsyncGenerator<FetchPage, FetchResultCursor> {
    const facet = type as ProviderFacet;
    const connector = createConnector(context);
    const capabilities = await getCapabilities(connector, context);

    switch (facet) {
      case ProviderFacet.M365Identities:
        return yield* fetchIdentities(connector, mode, cursor, capabilities);
      case ProviderFacet.M365Groups:
        return yield* fetchGroups(connector);
      case ProviderFacet.M365Licenses:
        return yield* fetchLicenses(connector);
      case ProviderFacet.M365CAPolicies:
        return yield* fetchConditionalAccessPolicies(
          connector,
          context,
          capabilities,
        );
      case ProviderFacet.M365AuthMethods:
        return yield* fetchAuthMethods(connector, context);
      case ProviderFacet.M365Devices:
        return yield* fetchDevices(connector);
      case ProviderFacet.M365OAuthGrants:
        return yield* fetchOAuthGrants(connector, context);
      case ProviderFacet.M365RiskyUsers:
        return yield* fetchRiskyUsers(connector, context, capabilities);
      default:
        throw new Error(`Unsupported M365 ingestion facet: ${type}`);
    }
  },
};

function createConnector(context: IngestionAdapterContext): M365Connector {
  const tenantId = getTenantId(context);
  const { clientId, clientSecret } = requireMicrosoftCredentials();
  return new M365Connector(clientId, clientSecret, tenantId);
}

function getTenantId(context: IngestionAdapterContext): string {
  const tenantId = context.linkMeta?.externalId;
  if (typeof tenantId === "string" && tenantId.length > 0) return tenantId;
  throw new Error(`M365 tenant ID missing for link ${context.linkId}`);
}

async function getCapabilities(
  connector: M365Connector,
  context: IngestionAdapterContext,
): Promise<Record<MSGraphCapabilities, boolean>> {
  const configured = context.linkMeta?.capabilities;
  if (
    configured &&
    typeof configured === "object" &&
    !Array.isArray(configured)
  ) {
    return configured as Record<MSGraphCapabilities, boolean>;
  }

  try {
    return (await new TenantCapabilityService(connector).probe(
      CAPABILITY_PLANS,
    )) as Record<MSGraphCapabilities, boolean>;
  } catch (error) {
    logger.warn("Failed to probe M365 tenant capabilities", {
      linkId: context.linkId,
      error: serializeError(error),
    });
    return {} as Record<MSGraphCapabilities, boolean>;
  }
}

async function* fetchIdentities(
  connector: M365Connector,
  mode: SyncMode,
  cursor: string | undefined,
  capabilities: Record<MSGraphCapabilities, boolean>,
): AsyncGenerator<FetchPage, FetchResultCursor> {
  const fields = [...M365_IDENTITY_BASE_FIELDS];
  if (capabilities.signInActivity) fields.push("signInActivity");

  if (mode === "full" || !cursor) {
    const users = await connector.users.listAll(fields.join(","));
    yield page(ProviderFacet.M365Identities, users);

    const cursorResult = await connector.users.delta(
      M365_IDENTITY_DELTA_FIELDS,
    );
    return cursorResult.cursor;
  }

  const result = await connector.users.delta(
    M365_IDENTITY_DELTA_FIELDS,
    cursor,
  );
  yield page(ProviderFacet.M365Identities, result.items);
  return result.cursor;
}

async function* fetchGroups(
  connector: M365Connector,
): AsyncGenerator<FetchPage> {
  const groups = await connector.groups.listAll(
    "id,displayName,description,groupTypes,mailEnabled,securityEnabled",
  );
  yield page(ProviderFacet.M365Groups, groups);
}

async function* fetchLicenses(
  connector: M365Connector,
): AsyncGenerator<FetchPage> {
  const [skus, skuNames] = await Promise.all([
    connector.subscribedSkus.listAll(),
    SkuCatalogService.resolve(),
  ]);
  const records = skus
    .filter((sku) => {
      const record = sku as Record<string, unknown>;
      return typeof record.skuPartNumber === "string"
        ? !M365_BLOAT_LICENSES.includes(record.skuPartNumber)
        : true;
    })
    .map((sku) => {
      const record = sku as Record<string, unknown>;
      const skuPartNumber =
        typeof record.skuPartNumber === "string"
          ? record.skuPartNumber
          : undefined;
      return {
        ...record,
        _friendlyName: skuPartNumber
          ? (skuNames.get(skuPartNumber) ?? skuPartNumber)
          : record.skuId,
      };
    });

  yield page(ProviderFacet.M365Licenses, records);
}

async function* fetchConditionalAccessPolicies(
  connector: M365Connector,
  context: IngestionAdapterContext,
  capabilities: Record<MSGraphCapabilities, boolean>,
): AsyncGenerator<FetchPage> {
  if (!capabilities.conditionalAccess) {
    logger.warn(
      "Skipping M365 CA policies because conditionalAccess capability is unavailable",
      {
        linkId: context.linkId,
      },
    );
    return;
  }

  const policies = await connector.conditionalAccess.policies();
  yield page(ProviderFacet.M365CAPolicies, policies);
}

async function* fetchAuthMethods(
  connector: M365Connector,
  context: IngestionAdapterContext,
): AsyncGenerator<FetchPage> {
  const allUsers = await connector.users.listIdsAll();
  const batchSize = 20;

  for (let index = 0; index < allUsers.length; index += batchSize) {
    const rows: unknown[] = [];

    for (const user of allUsers.slice(index, index + batchSize)) {
      try {
        const data = await connector.users.authMethods(user.id);
        for (const method of data.value) {
          const odataType =
            typeof method["@odata.type"] === "string"
              ? method["@odata.type"]
              : "";
          if (odataType === "#microsoft.graph.passwordAuthenticationMethod")
            continue;

          rows.push({
            ...method,
            _identity_external_id: user.id,
            _method_type: authMethodType(odataType),
          });
        }
      } catch (error) {
        logger.warn("Failed to fetch M365 auth methods for user", {
          linkId: context.linkId,
          userId: user.id,
          error: serializeError(error),
        });
      }
    }

    if (rows.length > 0) yield page(ProviderFacet.M365AuthMethods, rows);
  }
}

async function* fetchDevices(
  connector: M365Connector,
): AsyncGenerator<FetchPage> {
  const select =
    "id,displayName,operatingSystem,operatingSystemVersion,isCompliant,isManaged,deviceOwnership,approximateLastSignInDateTime,registrationDateTime";
  const devices = await connector.devices.listAll(select);
  yield page(ProviderFacet.M365Devices, devices);
}

async function* fetchOAuthGrants(
  connector: M365Connector,
  context: IngestionAdapterContext,
): AsyncGenerator<FetchPage> {
  const grants = (await connector.oauthGrants.listAll()) as Array<
    Record<string, unknown>
  >;
  const servicePrincipalIds = new Set<string>();

  for (const grant of grants) {
    if (typeof grant.clientId === "string")
      servicePrincipalIds.add(grant.clientId);
    if (typeof grant.resourceId === "string")
      servicePrincipalIds.add(grant.resourceId);
  }

  const displayNames = new Map<string, string>();
  if (servicePrincipalIds.size > 0) {
    try {
      const servicePrincipals = await connector.directoryObjects.getByIds(
        [...servicePrincipalIds],
        ["servicePrincipal"],
      );
      for (const servicePrincipal of servicePrincipals) {
        displayNames.set(
          servicePrincipal.id,
          servicePrincipal.displayName ?? "",
        );
      }
    } catch (error) {
      logger.warn(
        "Failed to resolve M365 OAuth grant service principal display names",
        {
          linkId: context.linkId,
          error: serializeError(error),
        },
      );
    }
  }

  yield page(
    ProviderFacet.M365OAuthGrants,
    grants.map((grant) => ({
      ...grant,
      clientDisplayName:
        typeof grant.clientId === "string"
          ? (displayNames.get(grant.clientId) ?? null)
          : null,
      resourceDisplayName:
        typeof grant.resourceId === "string"
          ? (displayNames.get(grant.resourceId) ?? null)
          : null,
    })),
  );
}

async function* fetchRiskyUsers(
  connector: M365Connector,
  context: IngestionAdapterContext,
  capabilities: Record<MSGraphCapabilities, boolean>,
): AsyncGenerator<FetchPage> {
  if (!capabilities.identityProtection) {
    logger.warn(
      "Skipping M365 risky users because identityProtection capability is unavailable",
      {
        linkId: context.linkId,
      },
    );
    return;
  }

  try {
    const filter =
      "riskState ne 'none' and riskState ne 'confirmedSafe' and riskState ne 'remediated' and riskState ne 'dismissed'";
    const users = await connector.identityProtection.riskyUsers(filter);
    yield page(ProviderFacet.M365RiskyUsers, users);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("403")) {
      logger.warn(
        "Skipping M365 risky users because IdentityRiskyUser.Read.All is unavailable",
        {
          linkId: context.linkId,
        },
      );
      return;
    }

    throw error;
  }
}

function page(facet: ProviderFacet, records: unknown[]): FetchPage {
  return {
    records: records.map((record) => envelope(facet, record)),
  };
}

function envelope(facet: ProviderFacet, record: unknown): RawRecordEnvelope {
  const raw = asRecord(record);
  const removed = raw["@removed"] != null;

  if (!removed) {
    const schema = getM365RawSchema(facet);
    if (schema) schema.parse(raw);
  }

  return {
    externalId: externalId(facet, raw),
    op: removed ? "delete" : "upsert",
    payload: raw,
  };
}

function externalId(
  facet: ProviderFacet,
  record: Record<string, unknown>,
): string {
  if (facet === ProviderFacet.M365AuthMethods) {
    return `${stringField(record, "_identity_external_id")}_${stringField(record, "id")}`;
  }

  if (facet === ProviderFacet.M365Licenses) return stringField(record, "skuId");

  return stringField(record, "id");
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`M365 record missing required string field ${key}`);
  }

  return value;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("M365 record is not an object");
  }

  return value as Record<string, unknown>;
}

function authMethodType(odataType: string): string {
  const typeMap: Record<string, string> = {
    "#microsoft.graph.emailAuthenticationMethod": "Email",
    "#microsoft.graph.fido2AuthenticationMethod": "FIDO2",
    "#microsoft.graph.microsoftAuthenticatorAuthenticationMethod":
      "Microsoft Authenticator",
    "#microsoft.graph.phoneAuthenticationMethod": "Phone",
    "#microsoft.graph.softwareOathAuthenticationMethod": "Software OAuth",
    "#microsoft.graph.windowsHelloForBusinessAuthenticationMethod":
      "Windows Hello",
    "#microsoft.graph.temporaryAccessPassAuthenticationMethod":
      "Temporary Pass",
    "#microsoft.graph.passwordAuthenticationMethod": "Password",
  };

  return typeMap[odataType] ?? "Unknown";
}
