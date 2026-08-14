import { z } from "zod";
import { asc, eq, inArray } from "drizzle-orm";
import { factRules, customerLogs } from "@mspbyte/drizzle";
import { TRPCError } from "@trpc/server";
import { PolicyTableShapes } from "@mspbyte/shared";
import { t, authProcedure } from "../trpc.js";
import type { Context } from "../context.js";

const factRuleInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  enabled: z.boolean().default(true),
  providerId: z.string().optional().nullable(),
  factKey: z.string().min(1),
  priority: z.number().int().default(0),
  definition: z.record(z.string(), z.unknown()),
});

function requireRead(ctx: Context) {
  if (!ctx.can("Policies.Read")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Policies.Read permission required" });
  }
}

function requireWrite(ctx: Context) {
  if (!ctx.can("Policies.Write")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Policies.Write permission required" });
  }
}

function requireDelete(ctx: Context) {
  if (!ctx.can("Policies.Delete")) {
    throw new TRPCError({ code: "FORBIDDEN", message: "Policies.Delete permission required" });
  }
}

function dataSource(definition: unknown): string {
  if (definition && typeof definition === "object" && "table" in definition) {
    const table = String((definition as { table?: unknown }).table ?? "");
    const shape = PolicyTableShapes.find((s) => s.table === table);
    if (shape) return shape.label;
    if (table) return table;
  }
  return "Unknown";
}

export const factRulesRouter = t.router({
  list: authProcedure.query(async ({ ctx }) => {
    requireRead(ctx);
    const rows = await ctx.db
      .select()
      .from(factRules)
      .orderBy(asc(factRules.priority), asc(factRules.name))
      .catch(() => []);
    return rows.map((row) => ({
      ...row,
      dataSource: dataSource(row.definition),
    }));
  }),

  byId: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      requireRead(ctx);
      const [row] = await ctx.db
        .select()
        .from(factRules)
        .where(eq(factRules.id, input.id))
        .limit(1);
      if (!row) throw new TRPCError({ code: "NOT_FOUND", message: "Fact rule not found" });
      return { ...row, dataSource: dataSource(row.definition) };
    }),

  create: authProcedure
    .input(factRuleInputSchema)
    .mutation(async ({ ctx, input }) => {
      requireWrite(ctx);
      const now = new Date().toISOString();
      const [created] = await ctx.db
        .insert(factRules)
        .values({
          name: input.name,
          description: input.description ?? null,
          enabled: input.enabled,
          providerId: input.providerId ?? null,
          factKey: input.factKey,
          priority: input.priority,
          definition: input.definition,
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: "user",
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: "create",
        actionLabel: "Created",
        targetType: "fact_rule",
        targetId: created!.id,
        targetLabel: created!.name,
        result: "success",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { factKey: created!.factKey },
      });
      return created!;
    }),

  update: authProcedure
    .input(factRuleInputSchema.extend({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      requireWrite(ctx);
      const now = new Date().toISOString();
      const [updated] = await ctx.db
        .update(factRules)
        .set({
          name: input.name,
          description: input.description ?? null,
          enabled: input.enabled,
          providerId: input.providerId ?? null,
          factKey: input.factKey,
          priority: input.priority,
          definition: input.definition,
          updatedAt: now,
        })
        .where(eq(factRules.id, input.id))
        .returning();
      if (!updated) throw new TRPCError({ code: "NOT_FOUND", message: "Fact rule not found" });
      await ctx.db.insert(customerLogs).values({
        siteId: null,
        actorType: "user",
        actorId: ctx.user.id,
        actorLabel: ctx.user.name || ctx.user.email,
        action: "update",
        actionLabel: "Updated",
        targetType: "fact_rule",
        targetId: updated.id,
        targetLabel: updated.name,
        result: "success",
        ipAddress: ctx.ipAddress,
        userAgent: ctx.userAgent,
        metadata: { factKey: updated.factKey },
      });
      return updated;
    }),

  delete: authProcedure
    .input(z.object({ ids: z.array(z.string().uuid()).min(1) }))
    .mutation(async ({ ctx, input }) => {
      requireDelete(ctx);
      const existing = await ctx.db
        .select({ id: factRules.id, name: factRules.name })
        .from(factRules)
        .where(inArray(factRules.id, input.ids));
      await ctx.db.delete(factRules).where(inArray(factRules.id, input.ids));
      await Promise.all(
        existing.map((row) =>
          ctx.db.insert(customerLogs).values({
            siteId: null,
            actorType: "user",
            actorId: ctx.user.id,
            actorLabel: ctx.user.name || ctx.user.email,
            action: "delete",
            actionLabel: "Deleted",
            targetType: "fact_rule",
            targetId: row.id,
            targetLabel: row.name,
            result: "success",
            ipAddress: ctx.ipAddress,
            userAgent: ctx.userAgent,
            metadata: {},
          })
        )
      );
      return { deleted: existing.length };
    }),
});
