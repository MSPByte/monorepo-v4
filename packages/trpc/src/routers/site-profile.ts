import { z } from 'zod';
import { and, eq } from 'drizzle-orm';
import {
  customerLogs,
  siteProfileFacts,
  siteProfileFields,
  siteProfileNotes,
  siteStackCategories,
  siteStackEntries
} from '@mspbyte/drizzle';
import {
  ActionLabels,
  BUILT_IN_PROFILE_FIELDS,
  BUILT_IN_STACK_CATEGORIES,
  hasPermission,
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
const profileFieldTypeEnum = z.enum(['string', 'number', 'boolean']);
const profileFieldValueModeEnum = z.enum(['single', 'multiple']);

type CatalogFieldOut = {
  id: string | null;
  key: string;
  label: string;
  section: 'executive' | 'context';
  type: 'string' | 'number' | 'boolean';
  valueMode: 'single' | 'multiple';
  displayOrder: number;
  values: string[] | null;
  active: boolean;
  builtIn: boolean;
};

type CatalogCategoryOut = {
  id: string | null;
  key: string;
  label: string;
  description: string;
  required: boolean;
  displayOrder: number;
  metadataFields: z.infer<typeof stackMetadataFieldSchema>[];
  builtIn: boolean;
};

export async function ensureCatalogDefaults(db: Context['db']) {
  await Promise.all([
    ...BUILT_IN_PROFILE_FIELDS.map((field) =>
      db
        .insert(siteProfileFields)
        .values({
          key: field.key,
          active: true,
          label: field.label,
          section: field.section,
          type: field.type,
          valueMode: field.valueMode,
          displayOrder: field.displayOrder,
          values: field.values ?? null
        })
        .onConflictDoNothing({ target: siteProfileFields.key })
        .catch(() => null)
    ),
    ...BUILT_IN_STACK_CATEGORIES.map((category) =>
      db
        .insert(siteStackCategories)
        .values({
          key: category.key,
          label: category.label,
          description: category.description,
          required: category.required,
          displayOrder: category.displayOrder,
          metadataFields: normalizeStackMetadataFields(category.metadataFields)
        })
        .onConflictDoUpdate({
          target: siteStackCategories.key,
          set: {
            label: category.label,
            description: category.description,
            required: category.required,
            displayOrder: category.displayOrder,
            metadataFields: normalizeStackMetadataFields(category.metadataFields)
          }
        })
        .catch(() => null)
    )
  ]);
}

function actorLabel(ctx: Context) {
  return ctx.user.name || ctx.user.email;
}

function requireSitePermission(ctx: Context, permission: Permission) {
  const attrs = (ctx.role.attributes as Record<string, boolean> | null) ?? null;
  if (!hasPermission(attrs, permission)) {
    throw new TRPCError({ code: 'FORBIDDEN', message: `${permission} permission required` });
  }
}

function normalizeStackStatus(status: z.infer<typeof stackStatusEnum>) {
  if (status === 'managed') return 'msp_managed';
  if (status === 'third_party') return 'vendor_managed';
  return status;
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

export const siteProfileRouter = t.router({
  catalog: authProcedure.query(async ({ ctx }) => {
    await ensureCatalogDefaults(ctx.db);
    const [customFields, customCategories] = await Promise.all([
      ctx.db
        .select()
        .from(siteProfileFields)
        .catch(() => []),
      ctx.db
        .select()
        .from(siteStackCategories)
        .catch(() => [])
    ]);

    const fieldByKey = new Map<string, CatalogFieldOut>(
      customFields.map((f) => [
        f.key,
        {
          id: f.id,
          key: f.key,
          label: f.label,
          section: f.section as 'executive' | 'context',
          type: f.type as 'string' | 'number' | 'boolean',
          valueMode: (f.valueMode ?? 'single') as 'single' | 'multiple',
          displayOrder: f.displayOrder ?? 0,
          values: (f.values as string[] | null) ?? null,
          active: f.active,
          builtIn: BUILT_IN_PROFILE_FIELDS.some((builtIn) => builtIn.key === f.key)
        }
      ])
    );
    for (const f of BUILT_IN_PROFILE_FIELDS) {
      if (fieldByKey.has(f.key)) continue;
      fieldByKey.set(f.key, {
        id: null,
        key: f.key,
        label: f.label,
        section: f.section,
        type: f.type,
        valueMode: f.valueMode,
        displayOrder: f.displayOrder,
        values: f.values ?? null,
        active: true,
        builtIn: true
      });
    }

    const categoryByKey = new Map<string, CatalogCategoryOut>(
      customCategories.map((c) => [
        c.key,
        {
          id: c.id,
          key: c.key,
          label: c.label,
          description: c.description,
          required: c.required,
          displayOrder: c.displayOrder,
          metadataFields: normalizeStackMetadataFields(
            c.metadataFields as z.infer<typeof stackMetadataFieldSchema>[] | null
          ),
          builtIn: BUILT_IN_STACK_CATEGORIES.some((builtIn) => builtIn.key === c.key)
        }
      ])
    );
    for (const c of BUILT_IN_STACK_CATEGORIES) {
      if (categoryByKey.has(c.key)) continue;
      categoryByKey.set(c.key, {
        id: null,
        key: c.key,
        label: c.label,
        description: c.description,
        required: c.required,
        displayOrder: c.displayOrder,
        metadataFields: normalizeStackMetadataFields(c.metadataFields),
        builtIn: true
      });
    }

    return {
      fields: [...fieldByKey.values()].sort((a, b) => a.displayOrder - b.displayOrder),
      categories: [...categoryByKey.values()].sort((a, b) => a.displayOrder - b.displayOrder)
    };
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
        type: profileFieldTypeEnum,
        valueMode: profileFieldValueModeEnum.default('single'),
        displayOrder: z.number().int().default(0),
        values: z.array(z.string()).nullable().optional(),
        active: z.boolean().default(true)
      })
    )
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Write');
      await ensureCatalogDefaults(ctx.db);
      if (input.id) {
        const [row] = await ctx.db
          .update(siteProfileFields)
          .set({
            label: input.label,
            section: input.section,
            type: input.type,
            valueMode: input.valueMode,
            displayOrder: input.displayOrder,
            values: input.values ?? null,
            active: input.active
          })
          .where(eq(siteProfileFields.id, input.id))
          .returning();
        if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
        return row;
      }
      const [row] = await ctx.db
        .insert(siteProfileFields)
        .values({
          key: input.key,
          label: input.label,
          section: input.section,
          type: input.type,
          valueMode: input.valueMode,
          displayOrder: input.displayOrder,
          values: input.values ?? null,
          active: input.active
        })
        .returning();
      if (!row) throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR' });
      return row;
    }),

  deleteField: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Delete');
      await ctx.db.delete(siteProfileFields).where(eq(siteProfileFields.id, input.id));
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
      await ensureCatalogDefaults(ctx.db);
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
      return row;
    }),

  deleteCategory: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireSitePermission(ctx, 'Sites.Delete');
      await ctx.db.delete(siteStackCategories).where(eq(siteStackCategories.id, input.id));
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
      requireSitePermission(ctx, 'Sites.Write');
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
      requireSitePermission(ctx, 'Sites.Delete');
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
