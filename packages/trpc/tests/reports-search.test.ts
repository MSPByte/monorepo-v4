import { describe, expect, test } from 'bun:test';
import { PgDialect } from 'drizzle-orm/pg-core';
import { and, sql } from 'drizzle-orm';
import { sophosFirewallsWithSite } from '@mspbyte/drizzle';
import { buildReportSearch, firewallLicenseMatch } from '../src/routers/reports-search.js';
import { querySqlTableData } from '../src/routers/table-data.js';

const dialect = new PgDialect();
const compile = (condition: ReturnType<typeof firewallLicenseMatch>) => dialect.sqlToQuery(condition);

describe('report license filtering and search', () => {
  test('contains matches product names through the firewall serial, not a nonexistent licenses column', () => {
    const query = compile(firewallLicenseMatch('contains', 'Appliance Base'));
    expect(query.sql).toContain('exists');
    expect(query.sql).toContain('firewall_licenses.product_name ilike');
    expect(query.sql).toContain('firewall_licenses.serial_number = "sophos_firewalls_with_site"."serial_number"');
    expect(query.params).toEqual(['%Appliance Base%']);
    expect(query.sql).not.toContain('"licenses"');
  });

  test('not equal excludes firewalls with any matching license; empty means no license rows', () => {
    const excluded = compile(firewallLicenseMatch('neq', 'Appliance Base'));
    expect(excluded.sql).toContain('not (exists');
    expect(excluded.params).toEqual(['Appliance Base']);
    expect(compile(firewallLicenseMatch('is_null')).sql).toContain('not (exists');
    expect(compile(firewallLicenseMatch('is_not_null')).sql).not.toContain('not (');
  });

  test('search combines native fields and license names with OR inside the permission scope', () => {
    const search = buildReportSearch(sophosFirewallsWithSite, 'sophosFirewalls', ['name', 'licenses'], 'Appliance Base');
    const query = compile(and(sql`site_id = ${'allowed-site'}`, search)!);
    expect(query.sql).toContain(' and ');
    expect(query.sql).toContain(' or ');
    expect(query.sql).toContain('"name"::text ilike');
    expect(query.sql).toContain('firewall_licenses.product_name ilike');
    expect(query.params).toEqual(['allowed-site', '%Appliance Base%', '%Appliance Base%']);
  });

  test('search escapes wildcard characters and never interpolates user text as SQL', () => {
    const query = compile(firewallLicenseMatch('contains', "50%_\\' OR true"));
    expect(query.params).toEqual(["%50\\%\\_\\\\' OR true%"]);
    expect(query.sql).not.toContain('OR true');
  });

  test('blank search is a no-op; unsupported display columns do not become SQL identifiers', () => {
    expect(buildReportSearch(sophosFirewallsWithSite, 'sophosFirewalls', ['name'], '  ')).toBeUndefined();
    const query = compile(buildReportSearch(sophosFirewallsWithSite, 'sophosFirewalls', ['unknownJoinedField'], 'test')!);
    expect(query.sql).toBe('false');
  });

  test('SQL errors in report queries propagate instead of becoming zero results', async () => {
    const failure = new Error('missing product_name');
    const db = { select: () => { throw failure; } };
    await expect(querySqlTableData(db as never, sophosFirewallsWithSite, { page: 1, pageSize: 25 })).rejects.toThrow('missing product_name');
  });
});

describe('report execution', () => {
  test('saved and table license filters use the same SQL path for paged results and exports', async () => {
    const { reportsRouter } = await import('../src/routers/reports.js');
    const whereClauses: string[] = [];
    const db = {
      select: () => {
        const query = {
          from: () => query,
          where: (condition: ReturnType<typeof sql> | undefined) => {
            if (condition) whereClauses.push(compile(condition).sql);
            return query;
          },
          limit: () => query,
          offset: () => query,
          orderBy: () => query,
          then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
        };
        return query;
      },
    };
    const caller = reportsRouter.createCaller({
      db, userId: 'test-user', user: { id: 'test-user' },
      can: () => true, scopeFor: () => 'all', linkScopeFor: () => 'all',
    } as never);
    const licenseFilter = { column: 'licenses', operator: 'contains' as const, value: 'Appliance Base' };
    for (const method of ['run', 'runBulk'] as const) {
      for (const adHoc of [false, true]) {
        whereClauses.length = 0;
        await caller[method]({
          source: 'sophosFirewalls',
          definition: { columns: ['name', 'licenses'], filters: adHoc ? [] : [licenseFilter] },
          table: { page: 1, pageSize: 25, filters: adHoc ? [licenseFilter] : [], globalSearch: 'branch' },
        });
        const dataClauses = whereClauses.filter(clause => clause.includes('firewall_licenses'));
        expect(dataClauses).toHaveLength(2); // Identical filtering for rows and total count.
        for (const clause of dataClauses) {
          expect(clause).toContain('firewall_licenses.product_name ilike');
          expect(clause).not.toContain('"licenses"');
          expect(clause).toContain('"name"::text ilike');
        }
      }
    }
  });
});
