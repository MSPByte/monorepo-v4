import {
  MICROSOFT_CLIENT_ID,
  MICROSOFT_CLIENT_SECRET,
  ENCRYPTION_KEY,
} from "$env/static/private";
import { PUBLIC_ORIGIN } from "$env/static/public";
import { fail, redirect } from "@sveltejs/kit";
import { z } from "zod";
import { createServerCaller } from "$lib/server/trpc";
import {
  CAPABILITY_PLANS,
  M365Connector,
  TenantCapabilityService,
  Encryption,
} from "@mspbyte/shared";
import type { Actions } from "./$types";

const M365ConfigSchema = z.object({
  tenantId: z.string(),
  clientId: z.string().optional(),
  clientSecret: z.string().optional(),
});

const TenantIdSchema = z
  .string()
  .trim()
  .min(1, "Tenant ID is required")
  .max(255, "Tenant ID is too long")
  .regex(/^[A-Za-z0-9.-]+$/, "Use a tenant GUID or verified domain");

export const actions: Actions = {
  initialConsent: ({ locals }) => {
    if (!MICROSOFT_CLIENT_ID || !PUBLIC_ORIGIN) {
      console.error(
        "[M365]:",
        "MICROSOFT_CLIENT_ID and PUBLIC_ORIGIN env vars are required",
      );
      return fail(500, {
        error: "MICROSOFT_CLIENT_ID and PUBLIC_ORIGIN env vars are required",
      });
    }

    const consentUrl = new URL(
      "https://login.microsoftonline.com/common/adminconsent",
    );
    consentUrl.searchParams.set("client_id", MICROSOFT_CLIENT_ID);
    consentUrl.searchParams.set(
      "redirect_uri",
      `${PUBLIC_ORIGIN}/setup/integrations/microsoft-365/consent`,
    );
    consentUrl.searchParams.set(
      "state",
      JSON.stringify({ orgId: locals.org?.id }),
    );

    console.log(consentUrl.href);
    return redirect(303, consentUrl.href);
  },

  gdapConsent: async ({ request }) => {
    const formData = await request.formData();
    const gdapTenantId = formData.get("gdapTenantId");
    if (!gdapTenantId || typeof gdapTenantId !== "string") {
      return fail(400, { error: "gdapTenantId is required" });
    }

    if (!MICROSOFT_CLIENT_ID || !PUBLIC_ORIGIN) {
      return fail(500, {
        error: "MICROSOFT_CLIENT_ID and PUBLIC_ORIGIN env vars are required",
      });
    }

    const consentUrl = new URL(
      `https://login.microsoftonline.com/${gdapTenantId}/adminconsent`,
    );
    consentUrl.searchParams.set("client_id", MICROSOFT_CLIENT_ID);
    consentUrl.searchParams.set(
      "redirect_uri",
      `${PUBLIC_ORIGIN}/setup/integrations/microsoft-365/consent`,
    );
    consentUrl.searchParams.set("state", JSON.stringify({ gdapTenantId }));

    return redirect(303, consentUrl.href);
  },

  deleteIntegration: async ({ locals }) => {
    try {
      const caller = createServerCaller(locals);
      await caller.integrations.delete({ id: "microsoft-365" });
    } catch (err) {
      return fail(500, { error: String(err) });
    }
    return redirect(303, "/setup/integrations/microsoft-365");
  },

  gdapSync: async ({ locals }) => {
    const caller = createServerCaller(locals);

    const integration = await caller.integrations.get({ id: "microsoft-365" });
    if (!integration || integration.deletedAt) {
      return fail(400, { error: "Microsoft 365 integration not configured" });
    }

    const configResult = M365ConfigSchema.safeParse(integration.config);
    if (!configResult.success) {
      return fail(400, { error: "Invalid integration configuration" });
    }
    const config = configResult.data;
    const mspTenantId = config.tenantId;

    const clientId = config.clientId ?? MICROSOFT_CLIENT_ID;
    const rawSecret = config.clientSecret
      ? (Encryption.decrypt(config.clientSecret, ENCRYPTION_KEY) ??
        MICROSOFT_CLIENT_SECRET)
      : MICROSOFT_CLIENT_SECRET;

    const connector = new M365Connector(clientId, rawSecret, mspTenantId);

    let relationships;
    try {
      relationships =
        await connector.tenantRelationships.delegatedAdminRelationships.listAll();
    } catch {
      return fail(502, {
        error: "Failed to list GDAP relationships from Microsoft",
      });
    }

    const activeCustomers = relationships.filter(
      (r) => r.status?.toLowerCase() === "active" && r.customer?.tenantId,
    );

    let mspDisplayName: string | null = null;
    try {
      const org = await connector.organization.get();
      mspDisplayName = org.displayName || null;
    } catch {
      /* non-fatal */
    }

    const existingLinks = await caller.integrationLinks.list({
      integrationId: "microsoft-365",
    });
    const tenantLinks = existingLinks.filter((l) => !l.siteId);
    const dbExternalIds = new Set(tenantLinks.map((l) => l.externalId));
    const gdapTenantIds = new Set(
      activeCustomers.map((r) => r.customer!.tenantId),
    );

    const toInsert = activeCustomers.filter(
      (r) => !dbExternalIds.has(r.customer!.tenantId),
    );
    const toDelete = tenantLinks.filter(
      (l) =>
        l.externalId &&
        (l.meta as Record<string, unknown> | null)?.source !== "manual" &&
        !gdapTenantIds.has(l.externalId) &&
        l.externalId !== mspTenantId,
    );

    let inserted = 0;
    for (const r of toInsert) {
      try {
        await caller.integrationLinks.create({
          integrationId: "microsoft-365",
          externalId: r.customer!.tenantId,
          name: r.customer!.displayName ?? r.customer!.tenantId,
          status: "disabled",
          meta: { source: "gdap" },
        });
        inserted++;
      } catch {
        /* log and continue */
      }
    }

    // Ensure MSP's own tenant is linked as active
    if (!dbExternalIds.has(mspTenantId)) {
      try {
        await caller.integrationLinks.create({
          integrationId: "microsoft-365",
          externalId: mspTenantId,
          name: mspDisplayName ?? mspTenantId,
          status: "active",
          meta: { source: "msp" },
        });
        inserted++;
      } catch {
        /* log and continue */
      }
    }

    let removed = 0;
    if (toDelete.length > 0) {
      try {
        await caller.integrationLinks.delete({
          ids: toDelete.map((l) => l.id),
        });
        removed = toDelete.length;
      } catch {
        /* log and continue */
      }
    }

    const links = await caller.integrationLinks.list({
      integrationId: "microsoft-365",
    });

    return { success: true, inserted, removed, links };
  },

  addTenant: async ({ request, locals }) => {
    const formData = await request.formData();
    const tenantIdResult = TenantIdSchema.safeParse(formData.get("tenantId"));
    if (!tenantIdResult.success) {
      return fail(400, {
        error: tenantIdResult.error.issues[0]?.message ?? "Invalid tenant ID",
      });
    }

    const displayName = formData.get("name");
    const name =
      typeof displayName === "string" && displayName.trim()
        ? displayName.trim()
        : tenantIdResult.data;

    const caller = createServerCaller(locals);
    const integration = await caller.integrations.get({ id: "microsoft-365" });
    if (!integration || integration.deletedAt) {
      return fail(400, { error: "Microsoft 365 integration not configured" });
    }

    const existingLinks = await caller.integrationLinks.list({
      integrationId: "microsoft-365",
    });
    const existingLink = existingLinks.find(
      (l) =>
        !l.siteId &&
        l.externalId?.toLowerCase() === tenantIdResult.data.toLowerCase(),
    );

    if (existingLink) {
      return { success: true, created: false, link: existingLink };
    }

    try {
      const link = await caller.integrationLinks.create({
        integrationId: "microsoft-365",
        externalId: tenantIdResult.data,
        name,
        status: "disabled",
        meta: {
          source: "manual",
          manuallyAddedAt: new Date().toISOString(),
        },
      });

      const links = await caller.integrationLinks.list({
        integrationId: "microsoft-365",
      });

      return { success: true, created: true, link, links };
    } catch (err) {
      return fail(500, { error: String(err) });
    }
  },

  refreshCapabilities: async ({ request, locals }) => {
    const formData = await request.formData();
    const externalId = formData.get("externalId");
    const linkId = formData.get("linkId");

    if (!externalId || typeof externalId !== "string")
      return fail(400, { error: "externalId is required" });
    if (!linkId || typeof linkId !== "string")
      return fail(400, { error: "linkId is required" });

    const caller = createServerCaller(locals);
    const integration = await caller.integrations.get({ id: "microsoft-365" });
    if (!integration || integration.deletedAt) {
      return fail(400, { error: "Microsoft 365 integration not configured" });
    }

    const configResult = M365ConfigSchema.safeParse(integration.config);
    if (!configResult.success)
      return fail(400, { error: "Invalid integration configuration" });
    const config = configResult.data;

    const clientId = config.clientId ?? MICROSOFT_CLIENT_ID;
    const rawSecret = config.clientSecret
      ? (Encryption.decrypt(config.clientSecret, ENCRYPTION_KEY) ??
        MICROSOFT_CLIENT_SECRET)
      : MICROSOFT_CLIENT_SECRET;

    // Scoped to the selected customer tenant, whether it came from GDAP or manual entry.
    const connector = new M365Connector(clientId, rawSecret, externalId);

    let capabilities: Record<string, boolean>;
    try {
      capabilities = await new TenantCapabilityService(connector).probe(CAPABILITY_PLANS);
    } catch {
      return fail(502, {
        error: "Could not probe capabilities — check tenant permissions",
      });
    }

    const links = await caller.integrationLinks.list({
      integrationId: "microsoft-365",
    });
    const link = links.find((l) => l.id === linkId);
    const existingMeta = (link?.meta as Record<string, unknown>) ?? {};

    try {
      await caller.integrationLinks.update({
        id: linkId,
        meta: {
          ...existingMeta,
          capabilities,
          capabilitiesCheckedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      return fail(500, { error: String(err) });
    }

    return { success: true };
  },
};
