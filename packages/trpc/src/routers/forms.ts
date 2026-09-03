import { z } from 'zod';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { TRPCError } from '@trpc/server';
import { agentForms } from '@mspbyte/drizzle';
import { t, authProcedure } from '../trpc.js';

const FieldSchema = z.object({
  id: z.string(),
  type: z.enum(['text', 'textarea', 'select', 'email', 'phone', 'checkbox', 'number', 'image']),
  label: z.string(),
  required: z.boolean().default(false),
  col_span: z.union([z.literal(1), z.literal(2), z.literal(3)]).default(1),
  placeholder: z.string().optional(),
  options: z.array(z.string()).optional(),
});

const RowSchema = z.object({
  cols: z.array(FieldSchema),
});

const PsaMappingEntrySchema = z.object({
  psa_field: z.string(),
});

export const formsRouter = t.router({
  list: authProcedure.query(async ({ ctx }) => {
    if (!ctx.can('Agents.Read')) {
      throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
    }

    return ctx.db
      .select({
        id: agentForms.id,
        name: agentForms.name,
        description: agentForms.description,
        createdAt: agentForms.createdAt,
        updatedAt: agentForms.updatedAt,
      })
      .from(agentForms)
      .where(isNull(agentForms.deletedAt))
      .orderBy(desc(agentForms.updatedAt));
  }),

  get: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Read')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Read permission required' });
      }

      const [row] = await ctx.db
        .select()
        .from(agentForms)
        .where(and(eq(agentForms.id, input.id), isNull(agentForms.deletedAt)))
        .limit(1);

      if (!row) throw new TRPCError({ code: 'NOT_FOUND' });
      return row;
    }),

  create: authProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      rows: z.array(RowSchema).default([]),
      psaMappings: z.record(z.string(), PsaMappingEntrySchema).default({}),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
      }

      const [row] = await ctx.db
        .insert(agentForms)
        .values({
          name: input.name,
          description: input.description ?? null,
          rows: input.rows,
          psaMappings: input.psaMappings,
          createdBy: ctx.user.id,
        })
        .returning({ id: agentForms.id });

      return row;
    }),

  update: authProcedure
    .input(z.object({
      id: z.string().uuid(),
      name: z.string().min(1).optional(),
      description: z.string().nullable().optional(),
      rows: z.array(RowSchema).optional(),
      psaMappings: z.record(z.string(), PsaMappingEntrySchema).optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Write')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Write permission required' });
      }

      const { id, ...fields } = input;
      const now = new Date().toISOString();

      await ctx.db
        .update(agentForms)
        .set({ ...fields, updatedAt: now })
        .where(and(eq(agentForms.id, id), isNull(agentForms.deletedAt)));

      return { ok: true };
    }),

  delete: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      if (!ctx.can('Agents.Delete')) {
        throw new TRPCError({ code: 'FORBIDDEN', message: 'Agents.Delete permission required' });
      }

      const now = new Date().toISOString();
      await ctx.db
        .update(agentForms)
        .set({ deletedAt: now })
        .where(and(eq(agentForms.id, input.id), isNull(agentForms.deletedAt)));

      return { ok: true };
    }),
});
