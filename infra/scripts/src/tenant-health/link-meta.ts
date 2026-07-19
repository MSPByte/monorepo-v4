import { and, eq, isNull } from "drizzle-orm";
import { integrationLinks, integrations } from "@mspbyte/drizzle";
import { INTEGRATIONS, META_VERSION_KEY, type ProviderId } from "@mspbyte/shared";
import type { HealthCheckContext, HealthReport } from "./index.js";
import { reconcileHaloPsaLinks } from "./vendors/halopsa.js";

export type StaleLink = {
  id: string;
  externalId: string | null;
  meta: Record<string, unknown>;
};

export type VendorReconcilerParams = {
  tenantDb: any;
  integrationConfig: Record<string, unknown>;
  staleLinks: StaleLink[];
  currentVersion: number;
};

export type VendorReconcilerResult = {
  updated: number;
  skipped: number;
  notes: string[];
};

export type VendorReconciler = (
  params: VendorReconcilerParams,
) => Promise<VendorReconcilerResult>;

const RECONCILERS: Partial<Record<ProviderId, VendorReconciler>> = {
  halopsa: reconcileHaloPsaLinks,
};

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export async function checkLinkMeta(ctx: HealthCheckContext): Promise<HealthReport> {
  const db = ctx.tenantDb as any;

  const installedIntegrations = await db
    .select()
    .from(integrations)
    .where(isNull(integrations.deletedAt));

  const summary: Record<string, { stale: number; fixed: number; skipped: number; noReconciler?: true }> = {};
  let totalStale = 0;
  let totalFixed = 0;
  const notes: string[] = [];

  for (const integrationRow of installedIntegrations) {
    const providerId = integrationRow.id as ProviderId;
    const vendor = INTEGRATIONS[providerId];
    if (!vendor) continue;

    const links = await db
      .select({
        id: integrationLinks.id,
        externalId: integrationLinks.externalId,
        meta: integrationLinks.meta,
      })
      .from(integrationLinks)
      .where(eq(integrationLinks.integrationId, integrationRow.id));

    const stale: StaleLink[] = [];
    for (const l of links) {
      const meta = asRecord(l.meta);
      if (meta[META_VERSION_KEY] !== vendor.linkMetaVersion) {
        stale.push({ id: l.id, externalId: l.externalId ?? null, meta });
      }
    }

    if (stale.length === 0) continue;
    totalStale += stale.length;
    summary[providerId] = { stale: stale.length, fixed: 0, skipped: 0 };

    const reconciler = RECONCILERS[providerId];
    if (!reconciler) {
      summary[providerId]!.noReconciler = true;
      notes.push(`${providerId}: ${stale.length} stale, no reconciler defined`);
      continue;
    }

    if (!ctx.fix) continue;

    const result = await reconciler({
      tenantDb: db,
      integrationConfig: asRecord(integrationRow.config),
      staleLinks: stale,
      currentVersion: vendor.linkMetaVersion,
    });
    totalFixed += result.updated;
    summary[providerId]!.fixed = result.updated;
    summary[providerId]!.skipped = result.skipped;
    for (const note of result.notes) notes.push(`${providerId}: ${note}`);
  }

  if (totalStale === 0) {
    return { check: "link-meta", status: "ok", details: "all links current" };
  }

  const summaryStr = Object.entries(summary)
    .map(([id, s]) =>
      s.noReconciler
        ? `${id}=${s.stale} stale (no reconciler)`
        : `${id}=${s.stale} stale/${s.fixed} fixed/${s.skipped} skipped`,
    )
    .join(", ");

  if (!ctx.fix) {
    return {
      check: "link-meta",
      status: "issues",
      details: `${totalStale} stale link(s) [${summaryStr}]`,
      metrics: { stale: totalStale, fixed: 0 },
    };
  }

  const withNotes = notes.length > 0 ? ` — ${notes.join("; ")}` : "";
  return {
    check: "link-meta",
    status: totalFixed === totalStale ? "fixed" : "issues",
    details: `${totalFixed}/${totalStale} reconciled [${summaryStr}]${withNotes}`,
    metrics: { stale: totalStale, fixed: totalFixed },
  };
}
