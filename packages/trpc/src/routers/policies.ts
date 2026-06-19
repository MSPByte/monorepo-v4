import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, inArray } from "drizzle-orm";
import {
  customerLogs,
  findings,
  integrationLinks,
  policies,
  policiesWithStats,
  policyAssignments,
  policySetItems,
  policySets,
  siteGroups,
  sites,
} from "@mspbyte/drizzle";
import { TRPCError } from "@trpc/server";
import { ActionLabels, hasPermission } from "@mspbyte/shared";
import { t, authProcedure } from "../trpc.js";
import { mockPolicies, mockFindings } from "./domain-fixtures.js";
import { queryTableData, tableDataInputSchema } from "./table-data.js";
import { shortId } from "../short-id.js";

const targetTypeSchema = z.enum([
  "tenant",
  "site",
  "integration_link",
  "person",
  "asset",
  "vendor",
]);
const severitySchema = z.number().int().min(1).max(4);
const policyDefinitionSchema = z.record(z.string(), z.unknown());
const scopeTypeSchema = z.enum([
  "global",
  "site",
  "site_group",
  "integration_link",
]);

const policyInputSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional().nullable(),
  category: z.string().optional().nullable(),
  providerId: z.string().optional().nullable(),
  targetType: targetTypeSchema,
  severity: severitySchema,
  enabled: z.boolean().default(true),
  recommendation: z.string().optional().nullable(),
  definition: policyDefinitionSchema,
});

const assignmentInputSchema = z
  .object({
    subjectType: z.enum(["policy", "policy_set"]),
    policyId: z.string().optional().nullable(),
    policySetId: z.string().uuid().optional().nullable(),
    scopeType: scopeTypeSchema,
    siteId: z.string().uuid().optional().nullable(),
    siteGroupId: z.string().uuid().optional().nullable(),
    linkId: z.string().uuid().optional().nullable(),
    includeChildSites: z.boolean().default(true),
    enabled: z.boolean().default(true),
    parameters: z.record(z.string(), z.unknown()).default({}),
  })
  .superRefine((input, ctx) => {
    if (input.subjectType === "policy" && !input.policyId) {
      ctx.addIssue({
        code: "custom",
        path: ["policyId"],
        message: "Policy is required",
      });
    }
    if (input.subjectType === "policy_set" && !input.policySetId) {
      ctx.addIssue({
        code: "custom",
        path: ["policySetId"],
        message: "Framework is required",
      });
    }
    if (input.scopeType === "site" && !input.siteId) {
      ctx.addIssue({
        code: "custom",
        path: ["siteId"],
        message: "Site is required",
      });
    }
    if (input.scopeType === "site_group" && !input.siteGroupId) {
      ctx.addIssue({
        code: "custom",
        path: ["siteGroupId"],
        message: "Site group is required",
      });
    }
    if (input.scopeType === "integration_link" && !input.linkId) {
      ctx.addIssue({
        code: "custom",
        path: ["linkId"],
        message: "Integration link is required",
      });
    }
  });

const mockPolicyRows = () =>
  mockPolicies.map((policy) => ({
    ...policy,
    targetType: policy.scope,
    frameworkList: policy.frameworkMembership.join(", "),
  }));

export const policiesRouter = t.router({
  tableData: authProcedure
    .input(tableDataInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await queryTableData(
        ctx.db,
        policiesWithStats,
        input,
        mockPolicyRows(),
        {
          column: "openFindingCount",
          direction: "desc",
        },
      );
      return {
        ...result,
        rows: result.rows.map((row) => ({
          ...row,
          scope: row.targetType,
          frameworkMembership:
            typeof row.frameworkList === "string" && row.frameworkList.length
              ? row.frameworkList.split(", ")
              : [],
        })),
      };
    }),

  list: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(policiesWithStats)
      .orderBy(policiesWithStats.name)
      .limit(500)
      .catch(() => []);
    if (!rows.length) return mockPolicies;

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      description: row.description ?? "",
      expectation: row.recommendation ?? "Structured policy expectation",
      enabled: row.enabled,
      severity: row.severity,
      category: row.category ?? "Operational",
      scope: row.targetType,
      source: row.source,
      frameworkMembership: row.frameworkList
        ? row.frameworkList.split(", ")
        : [],
      openFindingCount: row.openFindingCount,
      lastEvaluation: row.updatedAt,
    }));
  }),

  create: authProcedure
    .input(policyInputSchema)
    .mutation(async ({ ctx, input }) => {
      const idBase = input.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/(^-|-$)/g, "")
        .slice(0, 44);
      const id = `custom-${idBase || "policy"}-${shortId(6)}`;
      const [row] = await ctx.db
        .insert(policies)
        .values({
          id,
          source: "custom",
          name: input.name,
          description: input.description,
          category: input.category,
          providerId: input.providerId,
          targetType: input.targetType,
          severity: input.severity,
          enabled: input.enabled,
          recommendation: input.recommendation,
          definition: input.definition,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  update: authProcedure
    .input(policyInputSchema.extend({ id: z.string() }))
    .mutation(async ({ ctx, input }) => {
      const { id, ...values } = input;
      const [row] = await ctx.db
        .update(policies)
        .set({ ...values, updatedAt: new Date().toISOString() })
        .where(eq(policies.id, id))
        .returning();
      if (!row) throw new TRPCError({ code: "NOT_FOUND" });
      return row;
    }),

  delete: authProcedure
    .input(z.object({ ids: z.array(z.string()).min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const attrs = (ctx.role.attributes as Record<string, boolean>) ?? null;
      if (!hasPermission(attrs, "Assets.Delete")) {
        throw new TRPCError({ code: "FORBIDDEN", message: "Assets.Delete permission required" });
      }

      const uniqueIds = [...new Set(input.ids)];
      const rows = await ctx.db
        .select({
          id: policies.id,
          name: policies.name,
          source: policies.source,
          category: policies.category,
          providerId: policies.providerId,
          targetType: policies.targetType,
        })
        .from(policies)
        .where(inArray(policies.id, uniqueIds));

      if (rows.length === 0) {
        throw new TRPCError({ code: "NOT_FOUND", message: "No policies found" });
      }

      const batchId = randomUUID();
      const results: Array<{ id: string; name: string; success: boolean; error?: string }> = [];

      for (const row of rows) {
        let success = false;
        let error: string | undefined;

        try {
          await ctx.db.delete(findings).where(eq(findings.policyId, row.id));
          await ctx.db.delete(policyAssignments).where(eq(policyAssignments.policyId, row.id));
          await ctx.db.delete(policySetItems).where(eq(policySetItems.policyId, row.id));
          await ctx.db.delete(policies).where(eq(policies.id, row.id));
          success = true;
        } catch (err) {
          error = err instanceof Error ? err.message : String(err);
        }

        results.push({ id: row.id, name: row.name, success, error });

        await ctx.db.insert(customerLogs).values({
          siteId: null,
          actorType: "user",
          actorId: ctx.user.id,
          actorLabel: ctx.user.name || ctx.user.email,
          action: "delete",
          actionLabel: ActionLabels.PolicyDelete,
          targetType: "policy",
          targetId: row.id,
          targetLabel: row.name,
          result: success ? "success" : "failure",
          errorMessage: error,
          ipAddress: ctx.ipAddress,
          userAgent: ctx.userAgent,
          metadata: {
            batchId,
            source: row.source,
            category: row.category,
            providerId: row.providerId,
            targetType: row.targetType,
          },
        });
      }

      const deleted = results.filter((result) => result.success).length;
      const failed = results.length - deleted;
      return {
        batchId,
        requested: uniqueIds.length,
        found: rows.length,
        deleted,
        failed,
        results,
      };
    }),

  createAssignment: authProcedure
    .input(assignmentInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .insert(policyAssignments)
        .values({
          subjectType: input.subjectType,
          policyId: input.subjectType === "policy" ? input.policyId : null,
          policySetId:
            input.subjectType === "policy_set" ? input.policySetId : null,
          scopeType: input.scopeType,
          siteId: input.scopeType === "site" ? input.siteId : null,
          siteGroupId:
            input.scopeType === "site_group" ? input.siteGroupId : null,
          linkId: input.scopeType === "integration_link" ? input.linkId : null,
          includeChildSites: input.includeChildSites,
          enabled: input.enabled,
          parameters: input.parameters,
        })
        .returning();
      if (!row) throw new TRPCError({ code: "INTERNAL_SERVER_ERROR" });
      return row;
    }),

  listAssignments: authProcedure
    .input(
      z
        .object({
          policyId: z.string().optional(),
          policySetId: z.string().uuid().optional(),
        })
        .optional(),
    )
    .query(async ({ ctx, input }) => {
      const conditions = [];
      if (input?.policyId)
        conditions.push(eq(policyAssignments.policyId, input.policyId));
      if (input?.policySetId)
        conditions.push(eq(policyAssignments.policySetId, input.policySetId));
      return ctx.db
        .select({
          id: policyAssignments.id,
          subjectType: policyAssignments.subjectType,
          policyId: policyAssignments.policyId,
          policyName: policies.name,
          policySetId: policyAssignments.policySetId,
          policySetName: policySets.name,
          scopeType: policyAssignments.scopeType,
          siteId: policyAssignments.siteId,
          siteName: sites.name,
          siteGroupId: policyAssignments.siteGroupId,
          siteGroupName: siteGroups.name,
          linkId: policyAssignments.linkId,
          linkName: integrationLinks.name,
          includeChildSites: policyAssignments.includeChildSites,
          enabled: policyAssignments.enabled,
          updatedAt: policyAssignments.updatedAt,
        })
        .from(policyAssignments)
        .leftJoin(policies, eq(policyAssignments.policyId, policies.id))
        .leftJoin(policySets, eq(policyAssignments.policySetId, policySets.id))
        .leftJoin(sites, eq(policyAssignments.siteId, sites.id))
        .leftJoin(siteGroups, eq(policyAssignments.siteGroupId, siteGroups.id))
        .leftJoin(
          integrationLinks,
          eq(policyAssignments.linkId, integrationLinks.id),
        )
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(policyAssignments.updatedAt)
        .catch(() => []);
    }),

  deleteAssignment: authProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await ctx.db
        .delete(policyAssignments)
        .where(eq(policyAssignments.id, input.id));
      return { id: input.id };
    }),

  assignmentOptions: authProcedure.query(async ({ ctx }) => {
    const [siteRows, groupRows, linkRows] = await Promise.all([
      ctx.db
        .select({ id: sites.id, name: sites.name })
        .from(sites)
        .orderBy(sites.name)
        .catch(() => []),
      ctx.db
        .select({ id: siteGroups.id, name: siteGroups.name })
        .from(siteGroups)
        .orderBy(siteGroups.name)
        .catch(() => []),
      ctx.db
        .select({
          id: integrationLinks.id,
          name: integrationLinks.name,
          integrationId: integrationLinks.integrationId,
          siteId: integrationLinks.siteId,
        })
        .from(integrationLinks)
        .orderBy(integrationLinks.name)
        .catch(() => []),
    ]);
    return { sites: siteRows, siteGroups: groupRows, links: linkRows };
  }),

  byId: authProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(policies)
        .where(eq(policies.id, input.id))
        .limit(1)
        .catch(() => []);
      if (row) {
        return {
          id: row.id,
          name: row.name,
          description: row.description ?? "",
          expectation:
            typeof row.definition === "object" &&
            row.definition &&
            "kind" in row.definition
              ? String(row.definition.kind)
              : "Structured policy expectation",
          enabled: row.enabled,
          severity: row.severity,
          category: row.category ?? "Operational",
          scope: row.targetType,
          source: row.source,
          frameworkMembership: [],
          openFindingCount: 0,
          lastEvaluation: row.updatedAt,
          exampleFindings: [],
        };
      }

      const mock = mockPolicies.find((policy) => policy.id === input.id);
      if (!mock) throw new TRPCError({ code: "NOT_FOUND" });
      return {
        ...mock,
        exampleFindings: mockFindings
          .filter((finding) => finding.policyId === mock.id)
          .slice(0, 5),
      };
    }),
});
