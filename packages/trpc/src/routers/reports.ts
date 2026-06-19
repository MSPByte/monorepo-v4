import { z } from 'zod';
import { t, authProcedure } from '../trpc.js';
import { mockReports } from './domain-fixtures.js';

export const reportsRouter = t.router({
  list: authProcedure.query(() => mockReports),

  byId: authProcedure.input(z.object({ id: z.string() })).query(({ input }) => {
    return mockReports.find((report) => report.id === input.id) ?? null;
  })
});
