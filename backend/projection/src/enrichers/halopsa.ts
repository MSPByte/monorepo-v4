import { and, eq, inArray, isNull, not, sql } from "drizzle-orm";
import {
  billingPsaItems,
  haloPsaRecurringItems,
  integrationLinks,
  sites,
} from "@mspbyte/drizzle";
import { PROVIDER_IDS, ProviderFacet } from "@mspbyte/shared";
import type { ProjectionStep } from "../contracts/steps.js";

type HaloPsaRecurringItemRow = typeof haloPsaRecurringItems.$inferSelect;
type SiteRow = typeof sites.$inferSelect;

export const haloPsaEnrichers: readonly ProjectionStep[] = [
  {
    id: "halopsa-recurring-items-to-billing-psa-items",
    kind: "enrich",
    provider: PROVIDER_IDS.HALOPSA,
    triggerFacets: new Set([ProviderFacet.HaloPsaRecurringItems]),
    requiredFacets: [],
    run: projectRecurringItemsToBilling,
  },
];

async function projectRecurringItemsToBilling(context: {
  db: any;
  linkId: string;
}): Promise<Record<string, unknown>> {
  const rows = (await context.db
    .select()
    .from(haloPsaRecurringItems)
    .where(
      and(
        eq(haloPsaRecurringItems.linkId, context.linkId),
        isNull(haloPsaRecurringItems.deletedAt),
      ),
    )) as HaloPsaRecurringItemRow[];

  if (rows.length === 0) {
    const deletedCt = await softDeleteBillingItemsForLink(context.db, context.linkId);
    return { recordsIn: 0, recordsOut: deletedCt, createdCt: 0, updatedCt: deletedCt };
  }

  const linkRows = await context.db
    .select({ link: integrationLinks, site: sites })
    .from(integrationLinks)
    .leftJoin(sites, eq(integrationLinks.siteId, sites.id))
    .where(eq(integrationLinks.id, context.linkId));
  const link = linkRows[0]?.link;
  const site = linkRows[0]?.site as SiteRow | null | undefined;
  const haloLinkRows = await context.db
    .select({ link: integrationLinks, site: sites })
    .from(integrationLinks)
    .leftJoin(sites, eq(integrationLinks.siteId, sites.id))
    .where(eq(integrationLinks.integrationId, PROVIDER_IDS.HALOPSA));
  const siteByHaloExternalId = new Map<string, { siteId: string | null; siteName: string | null }>(
    haloLinkRows
      .filter((row: { link: typeof integrationLinks.$inferSelect }) => !!row.link.externalId)
      .map((row: { link: typeof integrationLinks.$inferSelect; site: SiteRow | null }) => [
        row.link.externalId!,
        { siteId: row.link.siteId, siteName: row.site?.name ?? row.link.name ?? null },
      ]),
  );

  const now = new Date().toISOString();
  const writeRows = rows.map((row) => {
    const mappedSite = row.externalSiteId ? siteByHaloExternalId.get(row.externalSiteId) : undefined;
    return {
      sourceProvider: "halopsa",
      sourceTable: "halopsa_recurring_items",
      sourceId: row.id,
      linkId: row.linkId,
      siteId: mappedSite?.siteId ?? row.siteId ?? link?.siteId ?? null,
      externalId: row.externalId,
      customerName: mappedSite?.siteName ?? site?.name ?? row.externalSiteId ?? link?.name ?? null,
      contractName: row.externalContractId,
      itemName: row.itemName,
      description: row.description,
      quantity: row.quantity,
      unitPrice: row.unitPrice,
      cost: row.cost,
      recurringPeriod: row.recurringPeriod,
      rawSummary: {
        externalClientId: row.externalClientId,
        externalSiteId: row.externalSiteId,
        externalContractId: row.externalContractId,
        externalInvoiceId: row.externalInvoiceId,
        externalItemId: row.externalItemId,
      },
      deletedAt: null,
      lastSeenAt: now,
      updatedAt: now,
    };
  });

  const returned = await context.db
    .insert(billingPsaItems)
    .values(writeRows)
    .onConflictDoUpdate({
      target: [billingPsaItems.sourceProvider, billingPsaItems.externalId],
      set: {
        sourceId: sql`excluded.source_id`,
        linkId: sql`excluded.link_id`,
        siteId: sql`excluded.site_id`,
        customerName: sql`excluded.customer_name`,
        contractName: sql`excluded.contract_name`,
        itemName: sql`excluded.item_name`,
        description: sql`excluded.description`,
        quantity: sql`excluded.quantity`,
        unitPrice: sql`excluded.unit_price`,
        cost: sql`excluded.cost`,
        recurringPeriod: sql`excluded.recurring_period`,
        rawSummary: sql`excluded.raw_summary`,
        deletedAt: null,
        lastSeenAt: now,
        updatedAt: now,
      },
    })
    .returning({ xmax: sql<string>`xmax::text` });

  const createdCt = returned.filter((row: { xmax?: string }) => row.xmax === "0").length;
  const updatedCt = returned.length - createdCt;
  const deletedCt = await softDeleteBillingItemsForLink(
    context.db,
    context.linkId,
    rows.map((row) => row.externalId),
  );

  return {
    recordsIn: rows.length,
    recordsOut: returned.length + deletedCt,
    createdCt,
    updatedCt: updatedCt + deletedCt,
  };
}

async function softDeleteBillingItemsForLink(
  db: any,
  linkId: string,
  activeExternalIds: string[] = [],
): Promise<number> {
  const now = new Date().toISOString();
  const where =
    activeExternalIds.length > 0
      ? and(
          eq(billingPsaItems.sourceProvider, "halopsa"),
          eq(billingPsaItems.linkId, linkId),
          isNull(billingPsaItems.deletedAt),
          not(inArray(billingPsaItems.externalId, activeExternalIds)),
        )
      : and(
          eq(billingPsaItems.sourceProvider, "halopsa"),
          eq(billingPsaItems.linkId, linkId),
          isNull(billingPsaItems.deletedAt),
        );

  const returned = await db
    .update(billingPsaItems)
    .set({ deletedAt: now, updatedAt: now })
    .where(where)
    .returning({ id: billingPsaItems.id });

  return returned.length;
}
