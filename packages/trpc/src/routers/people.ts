import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { peopleWithSites } from '@mspbyte/drizzle';
import { TRPCError } from '@trpc/server';
import { t, authProcedure } from '../trpc.js';
import { mockPeople, mockSites } from './domain-fixtures.js';
import { queryTableData, tableDataInputSchema } from './table-data.js';

const mockPersonRows = () =>
  mockPeople.map((person) => ({
    ...person,
    siteName: mockSites.find((site) => site.id === person.siteId)?.name ?? 'Unknown site',
    sourceList: person.sources.join(', '),
    licenseList: person.licenses.join(', ')
  }));

export const peopleRouter = t.router({
  tableData: authProcedure.input(tableDataInputSchema).query(async ({ ctx, input }) => {
    const result = await queryTableData(ctx.db, peopleWithSites, input, mockPersonRows(), {
      column: 'openFindingCount',
      direction: 'desc'
    });
    return {
      ...result,
      rows: result.rows.map((row) => ({
        ...row,
        sourceList: Array.isArray(row.sources) ? row.sources.join(', ') : '',
        licenseList: 'licenses' in row && Array.isArray(row.licenses) ? row.licenses.join(', ') : ''
      }))
    };
  }),

  list: authProcedure.query(async ({ ctx }) => {
    const rows = await ctx.db
      .select()
      .from(peopleWithSites)
      .orderBy(peopleWithSites.displayName)
      .limit(500)
      .catch(() => []);
    if (!rows.length) return mockPeople;

    return rows.map((row) => ({
      id: row.id,
      siteId: row.siteId,
      displayName: row.displayName,
      primaryEmail: row.primaryEmail,
      status: row.status,
      sources: row.sources,
      openFindingCount: row.openFindingCount,
      relatedAssets: [],
      licenses: [],
      vendorEvidence: []
    }));
  }),

  byId: authProcedure.input(z.object({ id: z.string() })).query(async ({ ctx, input }) => {
    const [row] = await ctx.db
      .select()
      .from(peopleWithSites)
      .where(eq(peopleWithSites.id, input.id))
      .limit(1)
      .catch(() => []);
    if (row) {
      return {
        id: row.id,
        siteId: row.siteId,
        displayName: row.displayName,
        primaryEmail: row.primaryEmail,
        status: row.status,
        sources: row.sources,
        openFindingCount: row.openFindingCount,
        relatedAssets: [],
        licenses: [],
        vendorEvidence: []
      };
    }

    const mock = mockPeople.find((person) => person.id === input.id);
    if (!mock) throw new TRPCError({ code: 'NOT_FOUND' });
    return mock;
  })
});
