import { and, eq, inArray, type SQL } from 'drizzle-orm';
import { organization } from './catalog/schema.js';

export type PipelineOrgFilter = {
  isProduction: boolean;
  targetOrgIds?: readonly string[];
};

// Shared WHERE clause used by every pipeline stage (scheduler + all three
// worker managers) to decide which orgs to include. Prod excludes dev orgs
// so we never touch a smoke-test tenant with real customer data. Dev
// includes every active org so we can smoke-test dev *and* prod orgs from
// the frontend. `targetOrgIds`, when supplied, narrows further (used by
// backfill scripts and local testing).
export function pipelineOrgWhere(filter: PipelineOrgFilter): SQL | undefined {
  const clauses = [eq(organization.status, 'active')];
  if (filter.isProduction) clauses.push(eq(organization.isDev, false));
  if (filter.targetOrgIds && filter.targetOrgIds.length > 0) {
    clauses.push(inArray(organization.id, filter.targetOrgIds));
  }
  return and(...clauses);
}
