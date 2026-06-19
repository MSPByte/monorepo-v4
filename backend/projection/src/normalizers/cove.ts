import {
  CoveAccountStatisticsSchema,
  ProviderFacet,
  type CoveAccountStatistics,
} from "@mspbyte/shared";

type RecordValue = Record<string, unknown>;

const BACKUP_STATUS: Record<string, string> = {
  "1": "In Process",
  "2": "Failed",
  "5": "Completed",
  "6": "Interrupted",
  "7": "Not Started",
  "8": "Completed with Errors",
};

const DEVICE_TYPE: Record<string, string> = {
  "1": "workstation",
  "2": "server",
};

export function normalizeCove(facet: string, raw: unknown): RecordValue {
  if (facet !== ProviderFacet.CoveEndpoints) {
    throw new Error(`Unsupported Cove projection facet: ${facet}`);
  }
  return normalizeAccount(CoveAccountStatisticsSchema.parse(raw));
}

function normalizeAccount(raw: CoveAccountStatistics): RecordValue {
  const settings = raw.Settings;

  const rawLastSuccess = settings["lastSuccessfulSession"];
  let lastSuccessAt: string | null = null;
  if (rawLastSuccess) {
    const seconds = Number.parseInt(rawLastSuccess, 10);
    if (Number.isFinite(seconds) && seconds > 0) {
      lastSuccessAt = new Date(seconds * 1000).toISOString();
    }
  }

  return {
    externalId: String(raw.AccountId),
    endpointName: settings["deviceName"] ?? "",
    hostname: settings["computerName"] ?? "",
    type: mapType(settings["deviceType"]),
    profile: settings["profile"] ?? "",
    retentionPolicy: settings["retentionPolicy"] ?? "",
    status: mapStatus(settings["backupStatus"]),
    lsvStatus: settings["lsvStatus"] || null,
    errors: Number.parseInt(settings["errors"] ?? "0", 10) || 0,
    selectedSize:
      Math.round(Number.parseFloat(settings["selectedSize"] ?? "0")) || 0,
    usedStorage:
      Math.round(Number.parseFloat(settings["usedStorage"] ?? "0")) || 0,
    last28Days: settings["last28Days"] ?? "",
    lastSuccessAt,
  };
}

function mapStatus(value: string | undefined): "active" | "inactive" | "error" {
  const status = BACKUP_STATUS[value ?? ""] ?? value ?? "";
  if (status === "Completed" || status === "In Process") return "active";
  if (status === "Not Started") return "inactive";
  return "error";
}

function mapType(value: string | undefined): "workstation" | "server" {
  return DEVICE_TYPE[value ?? ""] === "server" ? "server" : "workstation";
}
