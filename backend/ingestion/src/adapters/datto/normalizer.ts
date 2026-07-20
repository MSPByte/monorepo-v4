import {
  DattoDeviceSchema,
  ProviderFacet,
  type DattoDevice,
} from "@mspbyte/shared";

type RecordValue = Record<string, unknown>;

export function normalizeDatto(facet: string, raw: unknown): RecordValue {
  if (facet !== ProviderFacet.DattoEndpoints) {
    throw new Error(`Unsupported DattoRMM projection facet: ${facet}`);
  }
  return normalizeDevice(DattoDeviceSchema.parse(raw));
}

function normalizeDevice(raw: DattoDevice): RecordValue {
  return {
    externalId: raw.uid,
    hostname: raw.hostname,
    category: mapCategory(raw.deviceType?.category || "Unknown"),
    os: raw.operatingSystem ?? "Unknown",
    ipAddress: raw.intIpAddress,
    extAddress: raw.extIpAddress ?? "",
    online: raw.online,
    udfs: raw.udf ?? {},
    lastRebootAt: raw.lastReboot
      ? new Date(raw.lastReboot).toISOString()
      : new Date(0).toISOString(),
    lastHeartbeatAt: raw.lastSeen ? new Date(raw.lastSeen).toISOString() : null,
  };
}

function mapCategory(value: string): "workstation" | "server" | "other" {
  const lower = value.toLowerCase();
  if (lower === "server") return "server";
  if (lower === "desktop" || lower === "laptop" || lower === "workstation") {
    return "workstation";
  }
  return "other";
}
