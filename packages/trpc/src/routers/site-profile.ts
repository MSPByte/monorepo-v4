import { z } from 'zod';
import { and, asc, eq, inArray } from 'drizzle-orm';
import {
  customerLogs,
  integrationLinks,
  integrationLinkSiteAssignments,
  m365Identities,
  m365Licenses,
  siteProfileFacts,
  siteProfileFields,
  siteProfileNotes,
  siteStackCategories,
  siteStackEntries
} from '@mspbyte/drizzle';
import {
  ActionLabels,
  fieldTypeLabel,
  getSiteFactFieldType,
  isSiteFactFieldType,
  resolveSiteFactFieldType,
  siteFactFieldTypesForIntegrations,
  type Permission
} from '@mspbyte/shared';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import type { Context } from '../context.js';

const factSourceEnum = z.enum(['generated', 'user_options', 'user_free', 'user_flex']);
const applicableEnum = z.enum(['applies', 'not_applicable', 'unknown']);
const factValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.array(z.string()),
  z.null()
]);

const stackStatusEnum = z.enum([
  'managed',
  'third_party',
  'msp_managed',
  'client_managed',
  'vendor_managed',
  'not_used',
  'planned',
  'unknown'
]);
const stackMetadataSchema = z.record(z.string(), z.string().trim()).default({});
const stackMetadataFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits, underscores'),
  label: z.string().min(1),
  type: z.enum(['string', 'number', 'boolean', 'url', 'ip', 'secret_ref']).default('string'),
  required: z.boolean().default(false),
  helpText: z.string().nullable().optional()
});
const noteTypeEnum = z.enum(['special', 'tribal']);

const profileFieldSectionEnum = z.enum(['executive', 'context']);
type CatalogFieldOut = {
  id: string;
  key: string;
  label: string;
  section: 'executive' | 'context';
  type: 'string' | 'number' | 'boolean';
  valueMode: 'single' | 'multiple';
  displayOrder: number;
  values: string[] | null;
  active: boolean;
  valueType: string;
  valueTypeLabel: string;
};

type CatalogCategoryOut = {
  id: string;
  key: string;
  label: string;
  description: string;
  required: boolean;
  displayOrder: number;
  metadataFields: z.infer<typeof stackMetadataFieldSchema>[];
};

function actorLabel(ctx: Context) {
  return ctx.user.name || ctx.user.email;
}

function requireSitePermission(ctx: Context, permission: Permission, siteId?: string) {
  if (!ctx.can(permission)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${permission} permission required` });
  }
  if (siteId) {
    const scope = ctx.scopeFor(permission);
    if (scope !== 'all' && !scope.includes(siteId)) {
      throw new TRPCError({ code: 'NOT_FOUND' });
    }
  }
}

function normalizeStackStatus(status: z.infer<typeof stackStatusEnum>) {
  if (status === 'managed') return 'msp_managed';
  if (status === 'third_party') return 'vendor_managed';
  return status;
}

async function m365LinksForSite(ctx: Context, siteId: string) {
  const [directLinks, assignedLinks] = await Promise.all([
    ctx.db
      .select({ id: integrationLinks.id, name: integrationLinks.name })
      .from(integrationLinks)
      .where(
        and(
          eq(integrationLinks.siteId, siteId),
          eq(integrationLinks.integrationId, 'microsoft-365'),
          inArray(integrationLinks.status, ['active', 'mapping'])
        )
      ),
    ctx.db
      .select({ id: integrationLinks.id, name: integrationLinks.name })
      .from(integrationLinkSiteAssignments)
      .innerJoin(integrationLinks, eq(integrationLinks.id, integrationLinkSiteAssignments.linkId))
      .where(
        and(
          eq(integrationLinkSiteAssignments.siteId, siteId),
          eq(integrationLinks.integrationId, 'microsoft-365'),
          eq(integrationLinks.status, 'active')
        )
      )
  ]);
  return [...new Map([...directLinks, ...assignedLinks].map((link) => [link.id, link])).values()];
}

function normalizeStackMetadataFields(
  fields:
    | Array<Partial<z.infer<typeof stackMetadataFieldSchema>> & { key: string; label: string }>
    | null
    | undefined
) {
  return (fields ?? []).map((field) => ({
    key: field.key,
    label: field.label,
    type: field.type ?? 'string',
    required: field.required ?? false,
    helpText: field.helpText ?? null
  }));
}

async function validateManagedFactValue(
  ctx: Context,
  input: { siteId: string; key: string; value: z.infer<typeof factValueSchema> }
) {
  const [field] = await ctx.db
    .select({ key: siteProfileFields.key, valueType: siteProfileFields.valueType, valueMode: siteProfileFields.valueMode })
    .from(siteProfileFields)
    .where(eq(siteProfileFields.key, input.key))
    .limit(1);
  if (!field) return;

  const fieldType = resolveSiteFactFieldType(field);
  const definition = getSiteFactFieldType(fieldType);
  if (!definition?.entityType || input.value === null) return;

  const values = Array.isArray(input.value) ? input.value : [input.value];
  if (
    values.some((value) => typeof value !== 'string') ||
    (definition.valueMode === 'multiple' ? !Array.isArray(input.value) : Array.isArray(input.value))
  ) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${definition.label} requires ${definition.valueMode === 'multiple' ? 'a list of' : 'one'} valid selection${definition.valueMode === 'multiple' ? 's' : ''}` });
  }

  const links = definition.integrationId === 'microsoft-365'
    ? await m365LinksForSite(ctx, input.siteId)
    : await ctx.db
        .select({ id: integrationLinks.id, name: integrationLinks.name })
        .from(integrationLinks)
        .where(
          and(
            eq(integrationLinks.siteId, input.siteId),
            eq(integrationLinks.integrationId, definition.integrationId!),
            inArray(integrationLinks.status, ['active', 'mapping'])
          )
        );
  const linkIds = links.map((link) => link.id);
  if (linkIds.length === 0) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${definition.label} requires an enabled ${definition.family} integration on this site` });
  }

  const requested = [...new Set(values as string[])];
  if (definition.entityType === 'm365_identity') {
    const matches = await ctx.db
      .select({ id: m365Identities.id })
      .from(m365Identities)
      .where(and(inArray(m365Identities.id, requested), inArray(m365Identities.linkId, linkIds)));
    if (matches.length !== requested.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose Microsoft 365 identities from this site\'s tenant' });
    }
  }
  if (definition.entityType === 'm365_license') {
    const matches = await ctx.db
      .select({ skuId: m365Licenses.skuId })
      .from(m365Licenses)
      .where(and(inArray(m365Licenses.skuId, requested), inArray(m365Licenses.linkId, linkIds), eq(m365Licenses.isBloat, false)));
    if (new Set(matches.map((match) => match.skuId)).size !== requested.length) {
      throw new TRPCError({ code: 'BAD_REQUEST', message: 'Choose Microsoft 365 licenses from this site\'s tenant' });
    }
  }
}

async function auditCustomerChange(
  ctx: Context,
  input: {
    siteId: string;
    action: 'create' | 'update' | 'delete';
    actionLabel: ActionLabels;
    targetType: string;
    targetId: string;
    targetLabel: string;
    metadata?: Record<string, unknown>;
  }
) {
  await ctx.db.insert(customerLogs).values({
    siteId: input.siteId,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: actorLabel(ctx),
    action: input.action,
    actionLabel: input.actionLabel,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    result: 'success',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: input.metadata ?? null
  });
}

async function auditCatalogChange(
  ctx: Context,
  input: {
    action: 'create' | 'update' | 'delete';
    actionLabel: ActionLabels;
    targetType: string;
    targetId: string;
    targetLabel: string;
    metadata?: Record<string, unknown>;
  }
) {
  await ctx.db.insert(customerLogs).values({
    siteId: null,
    actorType: 'user',
    actorId: ctx.user.id,
    actorLabel: actorLabel(ctx),
    action: input.action,
    actionLabel: input.actionLabel,
    targetType: input.targetType,
    targetId: input.targetId,
    targetLabel: input.targetLabel,
    result: 'success',
    ipAddress: ctx.ipAddress,
    userAgent: ctx.userAgent,
    metadata: input.metadata ?? null
  });
}

export const siteProfileRouter = t.router({
  catalog: authProcedure.query(async ({ ctx }) => {
    const [fieldRows, categoryRows, enabledIntegrationRows] = await Promise.all([
      ctx.db.select().from(siteProfileFields).catch(() => []),
      ctx.db.select().from(siteStackCategories).catch(() => []),
      ctx.db
        .select({ integrationId: integrationLinks.integrationId })
        .from(integrationLinks)
        .where(inArray(integrationLinks.status, ['active', 'mapping']))
        .catch(() => [])
    ]);

    const fields: CatalogFieldOut[] = fieldRows
      .map((f) => {
        const valueType = resolveSiteFactFieldType(f);
        return {
          id: f.id,
          key: f.key,
          label: f.label,
          section: f.section as 'executive' | 'context',
          type: f.type as 'string' | 'number' | 'boolean',
          valueMode: (f.valueMode ?? 'single') as 'single' | 'multiple',
          displayOrder: f.displayOrder ?? 0,
          values: (f.values as string[] | null) ?? null,
          active: f.active,
          valueType,
          valueTypeLabel: fieldTypeLabel(valueType),
        };
      })
      .sort((a, b) => a.displayOrder - b.displayOrder);

    const categories: CatalogCategoryOut[] = categoryRows
      .map((c) => ({
        id: c.id,
        key: c.key,
        label: c.label,
        description: c.description,
        required: c.required,
        displayOrder: c.displayOrder,
        metadataFields: normalizeStackMetadataFields(
          c.metadataFields as z.infer<typeof stackMetadataFieldSchema>[] | null
        ),
      }))
      .sort((a, b) => a.displayOrder - b.displayOrder);

    return {
      fields,
      categories,
      fieldTypes: siteFactFieldTypesForIntegrations(
        enabledIntegrationRows.map((row) => row.integrationId)
      ),
    };
  }),

  // Resource-backed fact values are always scoped to the site's own active
  // integration links. A license SKU or identity from another customer must
  // never be selectable just because it exists in the tenant database.
  entityOptions: authProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        entityType: z.enum(['m365_identity', 'm365_license']),
        limit: z.number().int().min(1).max(500).default(200),
      })
    )
    .query(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Read', input.siteId);
      const links = await m365LinksForSite(ctx, input.siteId);
      if (links.length === 0) return [];

      const linkIds = links.map((link) => link.id);
      const linkNames = new Map(links.map((link) => [link.id, link.name]));
      if (input.entityType === 'm365_identity') {
        const rows = await ctx.db
          .select({
            id: m365Identities.id,
            linkId: m365Identities.linkId,
            name: m365Identities.name,
            email: m365Identities.email,
          })
          .from(m365Identities)
          .where(inArray(m365Identities.linkId, linkIds))
          .orderBy(asc(m365Identities.email))
          .limit(input.limit);
        return rows.map((row) => ({
          id: row.id,
          label: row.email || row.name || row.id,
          subLabel: [row.email ? row.name : undefined, linkNames.get(row.linkId)].filter(Boolean).join(' · ') || undefined,
        }));
      }

      const rows = await ctx.db
        .select({
          skuId: m365Licenses.skuId,
          linkId: m365Licenses.linkId,
          skuPartNumber: m365Licenses.skuPartNumber,
          friendlyName: m365Licenses.friendlyName,
          totalUnits: m365Licenses.totalUnits,
          consumedUnits: m365Licenses.consumedUnits,
          enabled: m365Licenses.enabled,
        })
        .from(m365Licenses)
        .where(and(inArray(m365Licenses.linkId, linkIds), eq(m365Licenses.isBloat, false)))
        .orderBy(asc(m365Licenses.friendlyName))
        .limit(input.limit);
      return rows
        .filter((row) => row.enabled !== false)
        .map((row) => {
          const available = Math.max(0, row.totalUnits - row.consumedUnits);
          return {
            id: row.skuId,
            label: row.friendlyName || row.skuPartNumber,
            subLabel: `${linkNames.get(row.linkId) ?? 'Microsoft 365'} · ${available} of ${row.totalUnits} available`,
            disabled: available === 0,
          };
        });
    }),

  upsertField: authProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        key: z
          .string()
          .min(1)
          .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits, underscores'),
        label: z.string().min(1),
        section: profileFieldSectionEnum,
        valueType: z.string().refine(isSiteFactFieldType, 'Choose a valid MSPByte field type'),
        displayOrder: z.number().int().default(0),
        values: z.array(z.string()).nullable().optional(),
        active: z.boolean().default(true)
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Write');
      const fieldType = getSiteFactFieldType(input.valueType);
      if (fieldType.integrationId) {
        const [enabledLink] = await ctx.db
          .select({ id: integrationLinks.id })
          .from(integrationLinks)
          .where(
            and(
              eq(integrationLinks.integrationId, fieldType.integrationId),
              inArray(integrationLinks.status, ['active', 'mapping'])
            )
          )
          .limit(1);
        if (!enabledLink) {
          throw new TRPCError({
            code: 'BAD_REQUEST',
            message: `${fieldType.label} requires an enabled ${fieldType.family} integration`,
          });
        }
      }
      if (input.id) {
        const [row] = await ctx.db
          .update(siteProfileFields)
          .set({
            label: input.label,
            section: input.section,
            type: fieldType.type,
            valueMode: fieldType.valueMode,
            valueType: input.valueType,
            displayOrder: input.displayOrder,
            values: fieldType.entityType ? null : input.values ?? null,
            active: input.active
          })
          .where(eq(siteProfileFields.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        await auditCatalogChange(ctx, {
          action: 'update',
          actionLabel: ActionLabels.SiteProfileFieldUpdate,
          targetType: 'site_profile_field',
          targetId: row.id,
          targetLabel: row.label,
          metadata: {
            key: row.key,
            section: row.section,
            type: row.type,
            valueMode: row.valueMode,
            valueType: row.valueType,
            active: row.active
          }
        });
        return row;
      }
      const [row] = await ctx.db
        .insert(siteProfileFields)
        .values({
          key: input.key,
          label: input.label,
          section: input.section,
          type: fieldType.type,
          valueMode: fieldType.valueMode,
          valueType: input.valueType,
          displayOrder: input.displayOrder,
          values: fieldType.entityType ? null : input.values ?? null,
          active: input.active
        })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await auditCatalogChange(ctx, {
        action: 'create',
        actionLabel: ActionLabels.SiteProfileFieldCreate,
        targetType: 'site_profile_field',
        targetId: row.id,
        targetLabel: row.label,
        metadata: {
          key: row.key,
          section: row.section,
          type: row.type,
          valueMode: row.valueMode,
          active: row.active
        }
      });
      return row;
    }),

  deleteField: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Delete');
      const [existing] = await ctx.db
        .select({ id: siteProfileFields.id, key: siteProfileFields.key, label: siteProfileFields.label })
        .from(siteProfileFields)
        .where(eq(siteProfileFields.id, input.id))
        .limit(1);
      await ctx.db.delete(siteProfileFields).where(eq(siteProfileFields.id, input.id));
      if (existing) {
        await auditCatalogChange(ctx, {
          action: 'delete',
          actionLabel: ActionLabels.SiteProfileFieldDelete,
          targetType: 'site_profile_field',
          targetId: existing.id,
          targetLabel: existing.label,
          metadata: { key: existing.key }
        });
      }
      return { ok: true };
    }),

  upsertCategory: authProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        key: z
          .string()
          .min(1)
          .regex(/^[a-z0-9_]+$/, 'lowercase letters, digits, underscores'),
        label: z.string().min(1),
        description: z.string().default(''),
        required: z.boolean().default(false),
        displayOrder: z.number().int().default(0),
        metadataFields: z.array(stackMetadataFieldSchema).default([])
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Write');
      if (input.id) {
        const [row] = await ctx.db
          .update(siteStackCategories)
          .set({
            label: input.label,
            description: input.description,
            required: input.required,
            displayOrder: input.displayOrder,
            metadataFields: input.metadataFields
          })
          .where(eq(siteStackCategories.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        await auditCatalogChange(ctx, {
          action: 'update',
          actionLabel: ActionLabels.SiteProfileCategoryUpdate,
          targetType: 'site_stack_category',
          targetId: row.id,
          targetLabel: row.label,
          metadata: {
            key: row.key,
            required: row.required,
            metadataFieldCount: input.metadataFields.length
          }
        });
        return row;
      }
      const [row] = await ctx.db
        .insert(siteStackCategories)
        .values({
          key: input.key,
          label: input.label,
          description: input.description,
          required: input.required,
          displayOrder: input.displayOrder,
          metadataFields: input.metadataFields
        })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await auditCatalogChange(ctx, {
        action: 'create',
        actionLabel: ActionLabels.SiteProfileCategoryCreate,
        targetType: 'site_stack_category',
        targetId: row.id,
        targetLabel: row.label,
        metadata: {
          key: row.key,
          required: row.required,
          metadataFieldCount: input.metadataFields.length
        }
      });
      return row;
    }),

  deleteCategory: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Delete');
      const [existing] = await ctx.db
        .select({ id: siteStackCategories.id, key: siteStackCategories.key, label: siteStackCategories.label })
        .from(siteStackCategories)
        .where(eq(siteStackCategories.id, input.id))
        .limit(1);
      await ctx.db.delete(siteStackCategories).where(eq(siteStackCategories.id, input.id));
      if (existing) {
        await auditCatalogChange(ctx, {
          action: 'delete',
          actionLabel: ActionLabels.SiteProfileCategoryDelete,
          targetType: 'site_stack_category',
          targetId: existing.id,
          targetLabel: existing.label,
          metadata: { key: existing.key }
        });
      }
      return { ok: true };
    }),

  reorderFields: authProcedure
    .input(z.array(z.object({ id: z.string().uuid(), displayOrder: z.number().int() })))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Write');
      await Promise.all(
        input.map((item) =>
          ctx.db
            .update(siteProfileFields)
            .set({ displayOrder: item.displayOrder })
            .where(eq(siteProfileFields.id, item.id))
        )
      );
      return { ok: true };
    }),

  reorderCategories: authProcedure
    .input(z.array(z.object({ id: z.string().uuid(), displayOrder: z.number().int() })))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Write');
      await Promise.all(
        input.map((item) =>
          ctx.db
            .update(siteStackCategories)
            .set({ displayOrder: item.displayOrder })
            .where(eq(siteStackCategories.id, item.id))
        )
      );
      return { ok: true };
    }),

  upsertFact: authProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        key: z.string().min(1),
        value: factValueSchema,
        source: factSourceEnum,
        origin: z.string().default('manual'),
        applicable: applicableEnum.default('applies'),
        confidence: z.enum(['high', 'medium', 'low']).nullable().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Write', input.siteId);
      await validateManagedFactValue(ctx, input);
      const now = new Date().toISOString();
      const [existing] = await ctx.db
        .select()
        .from(siteProfileFacts)
        .where(and(eq(siteProfileFacts.siteId, input.siteId), eq(siteProfileFacts.key, input.key)))
        .limit(1);
      if (existing) {
        const [row] = await ctx.db
          .update(siteProfileFacts)
          .set({
            value: input.value,
            source: input.source,
            origin: input.origin,
            applicable: input.applicable,
            confidence: input.confidence ?? null,
            updatedAt: now
          })
          .where(eq(siteProfileFacts.id, existing.id))
          .returning();
        await auditCustomerChange(ctx, {
          siteId: input.siteId,
          action: 'update',
          actionLabel: ActionLabels.SiteProfileFactUpdate,
          targetType: 'site_profile_fact',
          targetId: existing.id,
          targetLabel: input.key,
          metadata: {
            key: input.key,
            previousValue: existing.value,
            newValue: input.value,
            previousApplicable: existing.applicable,
            newApplicable: input.applicable
          }
        });
        return row;
      }
      const [row] = await ctx.db
        .insert(siteProfileFacts)
        .values({
          siteId: input.siteId,
          key: input.key,
          value: input.value,
          source: input.source,
          origin: input.origin,
          applicable: input.applicable,
          confidence: input.confidence ?? null
        })
        .returning();
      if (row) {
        await auditCustomerChange(ctx, {
          siteId: input.siteId,
          action: 'create',
          actionLabel: ActionLabels.SiteProfileFactCreate,
          targetType: 'site_profile_fact',
          targetId: row.id,
          targetLabel: input.key,
          metadata: {
            key: input.key,
            value: input.value,
            applicable: input.applicable
          }
        });
      }
      return row;
    }),

  deleteFact: authProcedure
    .input(z.object({ siteId: z.string().uuid(), key: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Delete', input.siteId);
      const [existing] = await ctx.db
        .select()
        .from(siteProfileFacts)
        .where(and(eq(siteProfileFacts.siteId, input.siteId), eq(siteProfileFacts.key, input.key)))
        .limit(1);
      await ctx.db
        .delete(siteProfileFacts)
        .where(and(eq(siteProfileFacts.siteId, input.siteId), eq(siteProfileFacts.key, input.key)));
      if (existing) {
        await auditCustomerChange(ctx, {
          siteId: input.siteId,
          action: 'delete',
          actionLabel: ActionLabels.SiteProfileFactDelete,
          targetType: 'site_profile_fact',
          targetId: existing.id,
          targetLabel: input.key,
          metadata: { key: input.key, previousValue: existing.value }
        });
      }
      return { ok: true };
    }),

  upsertStackEntry: authProcedure
    .input(
      z.object({
        siteId: z.string().uuid(),
        categoryKey: z.string().min(1),
        vendor: z.string().nullable().optional(),
        product: z.string().nullable().optional(),
        status: stackStatusEnum,
        notes: z.string().nullable().optional(),
        metadata: stackMetadataSchema.optional(),
        source: z.enum(['generated', 'manual']).default('manual'),
        origin: z.string().default('manual')
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Write');
      const categoryRow = await ctx.db
        .select()
        .from(siteStackCategories)
        .where(eq(siteStackCategories.key, input.categoryKey))
        .limit(1)
        .then((rows) => rows[0])
        .catch(() => undefined);

      const [existing] = await ctx.db
        .select()
        .from(siteStackEntries)
        .where(
          and(
            eq(siteStackEntries.siteId, input.siteId),
            eq(siteStackEntries.key, input.categoryKey)
          )
        )
        .limit(1);

      const status = normalizeStackStatus(input.status);
      const metadata = Object.fromEntries(
        Object.entries(input.metadata ?? {}).filter(([, value]) => value.trim().length > 0)
      );

      if (existing) {
        const [row] = await ctx.db
          .update(siteStackEntries)
          .set({
            categoryId: categoryRow?.id ?? null,
            vendor: input.vendor ?? null,
            product: input.product ?? null,
            status,
            notes: input.notes?.trim() || null,
            metadata,
            source: input.source,
            origin: input.origin
          })
          .where(eq(siteStackEntries.id, existing.id))
          .returning();
        await auditCustomerChange(ctx, {
          siteId: input.siteId,
          action: 'update',
          actionLabel: ActionLabels.SiteProfileStackUpdate,
          targetType: 'site_stack_entry',
          targetId: existing.id,
          targetLabel: input.categoryKey,
          metadata: {
            categoryKey: input.categoryKey,
            previousStatus: existing.status,
            newStatus: status,
            previousVendor: existing.vendor,
            newVendor: input.vendor ?? null,
            previousProduct: existing.product,
            newProduct: input.product ?? null,
            previousNotes: existing.notes,
            newNotes: input.notes?.trim() || null,
            previousMetadata: existing.metadata,
            newMetadata: metadata
          }
        });
        return row;
      }

      const [row] = await ctx.db
        .insert(siteStackEntries)
        .values({
          siteId: input.siteId,
          key: input.categoryKey,
          categoryId: categoryRow?.id ?? null,
          vendor: input.vendor ?? null,
          product: input.product ?? null,
          status,
          notes: input.notes?.trim() || null,
          metadata,
          source: input.source,
          origin: input.origin
        })
        .returning();
      if (row) {
        await auditCustomerChange(ctx, {
          siteId: input.siteId,
          action: 'create',
          actionLabel: ActionLabels.SiteProfileStackUpdate,
          targetType: 'site_stack_entry',
          targetId: row.id,
          targetLabel: input.categoryKey,
          metadata: {
            categoryKey: input.categoryKey,
            vendor: input.vendor ?? null,
            product: input.product ?? null,
            status,
            notes: input.notes?.trim() || null,
            metadata
          }
        });
      }
      return row;
    }),

  deleteStackEntry: authProcedure
    .input(z.object({ siteId: z.string().uuid(), categoryKey: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Delete');
      const [existing] = await ctx.db
        .select()
        .from(siteStackEntries)
        .where(
          and(
            eq(siteStackEntries.siteId, input.siteId),
            eq(siteStackEntries.key, input.categoryKey)
          )
        )
        .limit(1);
      await ctx.db
        .delete(siteStackEntries)
        .where(
          and(
            eq(siteStackEntries.siteId, input.siteId),
            eq(siteStackEntries.key, input.categoryKey)
          )
        );
      if (existing) {
        await auditCustomerChange(ctx, {
          siteId: input.siteId,
          action: 'delete',
          actionLabel: ActionLabels.SiteProfileStackUpdate,
          targetType: 'site_stack_entry',
          targetId: existing.id,
          targetLabel: input.categoryKey,
          metadata: {
            categoryKey: input.categoryKey,
            previousStatus: existing.status,
            previousVendor: existing.vendor,
            previousProduct: existing.product
          }
        });
      }
      return { ok: true };
    }),

  upsertNote: authProcedure
    .input(
      z.object({
        id: z.string().uuid().optional(),
        siteId: z.string().uuid(),
        type: noteTypeEnum,
        title: z.string().min(1),
        description: z.string().default(''),
        severity: z.number().int().min(0).max(5).default(0),
        active: z.boolean().default(true)
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Write');
      const now = new Date().toISOString();
      if (input.id) {
        const [row] = await ctx.db
          .update(siteProfileNotes)
          .set({
            type: input.type,
            title: input.title,
            description: input.description,
            severity: input.severity,
            active: input.active,
            updatedBy: ctx.user.id,
            updatedAt: now
          })
          .where(eq(siteProfileNotes.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        await auditCustomerChange(ctx, {
          siteId: row.siteId,
          action: 'update',
          actionLabel: ActionLabels.SiteProfileNoteUpdate,
          targetType: 'site_profile_note',
          targetId: row.id,
          targetLabel: row.title,
          metadata: {
            type: row.type,
            title: row.title,
            severity: row.severity,
            active: row.active
          }
        });
        return row;
      }
      const [row] = await ctx.db
        .insert(siteProfileNotes)
        .values({
          siteId: input.siteId,
          type: input.type,
          title: input.title,
          description: input.description,
          severity: input.severity,
          active: input.active,
          updatedBy: ctx.user.id
        })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      await auditCustomerChange(ctx, {
        siteId: input.siteId,
        action: 'create',
        actionLabel: ActionLabels.SiteProfileNoteCreate,
        targetType: 'site_profile_note',
        targetId: row.id,
        targetLabel: row.title,
        metadata: {
          type: row.type,
          title: row.title,
          severity: row.severity,
          active: row.active
        }
      });
      return row;
    }),

  deleteNote: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Delete');
      const [existing] = await ctx.db
        .select()
        .from(siteProfileNotes)
        .where(eq(siteProfileNotes.id, input.id))
        .limit(1);
      await ctx.db.delete(siteProfileNotes).where(eq(siteProfileNotes.id, input.id));
      if (existing) {
        await auditCustomerChange(ctx, {
          siteId: existing.siteId,
          action: 'delete',
          actionLabel: ActionLabels.SiteProfileNoteDelete,
          targetType: 'site_profile_note',
          targetId: existing.id,
          targetLabel: existing.title,
          metadata: {
            type: existing.type,
            title: existing.title,
            severity: existing.severity
          }
        });
      }
      return { ok: true };
    })
});
