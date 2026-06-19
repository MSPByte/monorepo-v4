import { ENCRYPTION_KEY } from '$env/static/private';
import { createTenantDb } from '@mspbyte/drizzle-catalog';
import { m365Groups, m365Identities, m365Roles } from '@mspbyte/drizzle';
import { error, json, type RequestHandler } from '@sveltejs/kit';
import { asc, eq, ilike, or } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

type ReferenceOption = {
  value: string;
  label: string;
};

type ReferenceConfig = {
  table: typeof m365Identities | typeof m365Groups | typeof m365Roles;
  columns: Record<string, PgColumn>;
};

const referenceTables = {
  m365Identities: {
    table: m365Identities,
    columns: {
      externalId: m365Identities.externalId,
      name: m365Identities.name,
      email: m365Identities.email,
    },
  },
  m365Groups: {
    table: m365Groups,
    columns: {
      externalId: m365Groups.externalId,
      name: m365Groups.name,
    },
  },
  m365Roles: {
    table: m365Roles,
    columns: {
      id: m365Roles.id,
      externalId: m365Roles.externalId,
      templateId: m365Roles.templateId,
      name: m365Roles.name,
    },
  },
  m365roles: {
    table: m365Roles,
    columns: {
      id: m365Roles.id,
      externalId: m365Roles.externalId,
      templateId: m365Roles.templateId,
      name: m365Roles.name,
    },
  },
} satisfies Record<string, ReferenceConfig>;

export const GET: RequestHandler = async ({ locals, url }) => {
  const tableName = url.searchParams.get('table');
  const valueColumnName = url.searchParams.get('valueColumn');
  const labelColumnName = url.searchParams.get('labelColumn');
  const query = url.searchParams.get('query')?.trim();
  const exactValue = url.searchParams.get('exactValue')?.trim();

  if (!tableName || !valueColumnName || !labelColumnName) {
    throw error(400, 'table, valueColumn, and labelColumn are required');
  }

  const config = referenceTables[tableName as keyof typeof referenceTables];
  if (!config) {
    throw error(400, 'Unsupported reference table');
  }

  const columns = config.columns as Record<string, PgColumn | undefined>;
  const valueColumn = columns[valueColumnName];
  const labelColumn = columns[labelColumnName];
  if (!valueColumn || !labelColumn) {
    throw error(400, 'Unsupported reference column');
  }

  const db = createTenantDb(locals.connectionString, ENCRYPTION_KEY);
  const where = exactValue
    ? eq(valueColumn, exactValue)
    : query
      ? or(ilike(labelColumn, `%${query}%`), ilike(valueColumn, `%${query}%`))
      : undefined;

  const rows = (await db
    .select({
      value: valueColumn,
      label: labelColumn,
    })
    .from(config.table)
    .where(where)
    .orderBy(asc(labelColumn))
    .limit(50)) as ReferenceOption[];

  return json(rows);
};
