import { eq } from "drizzle-orm";
import { integrationLinks } from "@mspbyte/drizzle";
import { HaloPSAConnector } from "@mspbyte/connectors";
import { Encryption } from "@mspbyte/encryption";
import { META_VERSION_KEY } from "@mspbyte/shared";
import { requireEncryptionKey } from "../../env.js";
import type { VendorReconciler } from "../link-meta.js";

function requireString(
  config: Record<string, unknown>,
  key: string,
): string {
  const value = config[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`HaloPSA integrationConfig.${key} missing`);
  }
  return value;
}

export const reconcileHaloPsaLinks: VendorReconciler = async ({
  tenantDb,
  integrationConfig,
  staleLinks,
  currentVersion,
}) => {
  const notes: string[] = [];
  let updated = 0;
  let skipped = 0;

  const linksWithExternal = staleLinks.filter((l) => !!l.externalId);
  const missingExternalId = staleLinks.length - linksWithExternal.length;
  if (missingExternalId > 0) {
    skipped += missingExternalId;
    notes.push(`${missingExternalId} link(s) missing externalId`);
  }
  if (linksWithExternal.length === 0) {
    return { updated, skipped, notes };
  }

  const url = requireString(integrationConfig, "url").replace(/\/+$/, "");
  const clientId = requireString(integrationConfig, "clientId");
  const clientSecretEnc = requireString(integrationConfig, "clientSecret");
  const clientSecret = Encryption.decrypt(clientSecretEnc, requireEncryptionKey());
  if (!clientSecret) {
    throw new Error("HaloPSA client secret could not be decrypted");
  }

  // One /api/site call for the whole org — this is the whole point of the
  // batch approach vs runtime per-link healing.
  const connector = new HaloPSAConnector(url, clientId, clientSecret);
  const sites = await connector.site.list();

  const siteById = new Map<string, { client_id: number }>();
  for (const site of sites) {
    siteById.set(String(site.id), { client_id: site.client_id });
  }

  const now = new Date().toISOString();
  for (const link of linksWithExternal) {
    const site = siteById.get(String(link.externalId));
    if (!site) {
      skipped++;
      notes.push(`site ${link.externalId} not found in HaloPSA response`);
      continue;
    }

    const nextMeta: Record<string, unknown> = {
      clientId: site.client_id,
      [META_VERSION_KEY]: currentVersion,
    };

    await tenantDb
      .update(integrationLinks)
      .set({ meta: nextMeta, updatedAt: now })
      .where(eq(integrationLinks.id, link.id));
    updated++;
  }

  return { updated, skipped, notes };
};
