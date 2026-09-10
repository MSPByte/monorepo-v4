import { or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { sophosFirewallsWithSite } from '@mspbyte/drizzle';

/** Match the same serial-number relationship used to display firewall licenses. */
export function firewallLicenseMatch(operator: string, value?: string): SQL {
  let productWhere: SQL | undefined;
  if (operator === 'contains') {
    productWhere = sql`firewall_licenses.product_name ilike ${containsPattern(value ?? '')}`;
  } else if (operator === 'eq' || operator === 'neq') {
    productWhere = sql`firewall_licenses.product_name = ${value ?? ''}`;
  }
  const match = sql`exists (
    select 1 from vendors.sophos_firewall_licenses as firewall_licenses
    where firewall_licenses.serial_number = ${sophosFirewallsWithSite.serialNumber}
    ${productWhere ? sql`and ${productWhere}` : sql``}
  )`;
  return operator === 'neq' || operator === 'is_null' ? sql`not (${match})` : match;
}

function containsPattern(value: string): string {
  return `%${value.replace(/[\\%_]/g, '\\$&')}%`;
}

/** Search saved report columns before counting/pagination, including license names. */
export function buildReportSearch(
  table: Record<string, unknown>,
  source: string,
  columns: string[],
  search: string | undefined
): SQL | undefined {
  if (!search?.trim()) return undefined;
  const term = search.trim();
  const parts: SQL[] = [];
  for (const key of columns) {
    if (source === 'sophosFirewalls' && key === 'licenses') {
      parts.push(firewallLicenseMatch('contains', term));
    } else if (typeof (table[key] as SQLWrapper | undefined)?.getSQL === 'function') {
      parts.push(sql`${table[key] as SQLWrapper}::text ilike ${containsPattern(term)}`);
    }
  }
  return parts.length ? or(...parts) : sql`false`;
}
