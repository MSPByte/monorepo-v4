import {
  ProviderFacet,
  SophosEndpointSchema,
  SophosFirewallSchema,
  SophosLicenseSchema,
  SophosTamperProtectionSchema,
  type SophosEndpoint,
  type SophosFirewall,
  type SophosLicense,
  type SophosTamperProtection,
} from "@mspbyte/shared";

type RecordValue = Record<string, unknown>;

export function normalizeSophos(facet: string, raw: unknown): RecordValue {
  switch (facet) {
    case ProviderFacet.SophosEndpoints:
      return normalizeEndpoint(SophosEndpointSchema.parse(raw));
    case ProviderFacet.SophosFirewalls:
      return normalizeFirewall(SophosFirewallSchema.parse(raw));
    case ProviderFacet.SophosLicenses:
      return normalizeLicense(SophosLicenseSchema.parse(raw));
    case ProviderFacet.SophosTamperProtection:
      return normalizeTamperProtection(
        SophosTamperProtectionSchema.parse(raw),
      );
    default:
      throw new Error(`Unsupported Sophos projection facet: ${facet}`);
  }
}

function normalizeEndpoint(raw: SophosEndpoint): RecordValue {
  return {
    externalId: raw.id,
    hostname: raw.hostname,
    type: raw.type === "server" ? "server" : "computer",
    platform: raw.os.platform,
    osName: raw.os.name,
    health: mapHealth(raw.health.overall),
    online: raw.online,
    needsUpgrade: raw.packages?.protection?.status === "upgradable",
    hasMdr: raw.mdrManaged,
    tamperProtectionEnabled: raw.tamperProtectionEnabled === true,
    lockdown: raw.lockdown.status,
    lastHeartbeatAt: dateString(raw.lastSeenAt),
  };
}

function normalizeFirewall(raw: SophosFirewall): RecordValue {
  return {
    externalId: raw.id,
    name: raw.name,
    hostname: raw.hostname,
    model: raw.model ?? "",
    serialNumber: raw.serialNumber,
    firmwareVersion: raw.firmwareVersion ?? "",
    externalIp: raw.externalIpv4Addresses?.[0] ?? "",
    connected: raw.status?.connected === true,
    suspended: raw.status?.suspended === true,
    managing: raw.status?.managingStatus ?? "Unknown",
    reporting: raw.status?.reportingStatus ?? "Unknown",
    upgradeToVersion: raw._upgrade_to_version ?? null,
    lastChangeAt: dateString(raw.stateChangedAt) ?? new Date().toISOString(),
  };
}

function normalizeLicense(raw: SophosLicense): RecordValue {
  return {
    externalId: raw.id,
    licenseId: raw.licenseIdentifier,
    code: raw.product.code,
    name: raw.product.name ?? "Unknown",
    type: raw.type,
    perpetual: raw.perpetual,
    unlimited: raw.unlimited,
    quantity: raw.quantity ?? null,
    usageCount: raw.usage?.current?.count ?? null,
    startedAt: dateString(raw.startDate) ?? new Date().toISOString(),
    endsAt: dateString(raw.endDate),
  };
}

function normalizeTamperProtection(raw: SophosTamperProtection): RecordValue {
  return {
    endpointId: raw._endpoint_id,
    password: raw.password,
    previous: (raw.previousPasswords ?? [])
      .map((entry) => entry.password)
      .filter((password) => password !== raw.password && password.length > 0),
  };
}

function mapHealth(
  value: string,
): "good" | "suspicious" | "bad" | "unknown" {
  if (value === "good" || value === "suspicious" || value === "bad") return value;
  return "unknown";
}

function dateString(value: string | null | undefined): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
