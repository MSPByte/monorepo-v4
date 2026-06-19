import { z } from "zod";
import { eq } from "drizzle-orm";
import { assetsWithSites } from "@mspbyte/drizzle";
import { TRPCError } from "@trpc/server";
import { t, authProcedure } from "../trpc.js";
import { mockAssets, mockSites } from "./domain-fixtures.js";
import { queryTableData, tableDataInputSchema } from "./table-data.js";

const mockAssetRows = () =>
  mockAssets.map((asset) => ({
    ...asset,
    assetType: asset.type,
    siteName:
      mockSites.find((site) => site.id === asset.siteId)?.name ??
      "Unknown site",
    sourceList: asset.sources.join(", "),
  }));

export const assetsRouter = t.router({
  tableData: authProcedure
    .input(tableDataInputSchema)
    .query(async ({ ctx, input }) => {
      const result = await queryTableData(
        ctx.db,
        assetsWithSites,
        input,
        mockAssetRows(),
        {
          column: "openFindingCount",
          direction: "desc",
        },
      );
      return {
        ...result,
        rows: result.rows.map((row) => ({
          ...row,
          sourceList: Array.isArray(row.sources) ? row.sources.join(", ") : "",
        })),
      };
    }),

  list: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(assetsWithSites)
      .orderBy(assetsWithSites.displayName)
      .limit(500)
      .catch(() => []);
    if (!rows.length) return mockAssets;

    return rows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      hostname: row.hostname ?? row.displayName,
      displayName: row.displayName,
      type: row.assetType,
      os: row.os ?? "Unknown",
      status: row.status,
      sources: row.sources,
      openFindingCount: row.openFindingCount,
      relatedPeople: [],
      vendorEvidence: [],
    }));
  }),

  byId: authProcedure
    .input(z.object({ id: z.string() }))
    .query(async ({ ctx, input }) => {
      const [row] = await ctx.db
        .select()
        .from(assetsWithSites)
        .where(eq(assetsWithSites.id, input.id))
        .limit(1)
        .catch(() => []);
      if (row) {
        return {
          id: row.id,
          siteId: row.siteId,
          hostname: row.hostname ?? row.displayName,
          displayName: row.displayName,
          type: row.assetType,
          os: row.os ?? "Unknown",
          status: row.status,
          sources: row.sources,
          openFindingCount: row.openFindingCount,
          relatedPeople: [],
          vendorEvidence: [],
        };
      }

      const mock = mockAssets.find((asset) => asset.id === input.id);
      if (!mock) throw new TRPCError({ code: "NOT_FOUND" });
      return mock;
    }),
});
