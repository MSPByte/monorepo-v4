import { count, sql } from "drizzle-orm";
import { z } from "zod";

export const tableFilterSchema = z.object({
  column: z.string(),
  operator: z.enum([
    "eq",
    "neq",
    "contains",
    "gt",
    "gte",
    "lt",
    "lte",
    "is_null",
    "is_not_null",
  ]),
  value: z.union([z.string(), z.number(), z.boolean()]).optional(),
});

export const tableDataInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z.number().int().min(1).max(1000).default(25),
  sortColumn: z.string().optional(),
  sortDirection: z.enum(["asc", "desc"]).optional(),
  filters: z.array(tableFilterSchema).optional(),
  globalSearch: z.string().optional(),
  globalSearchColumns: z.array(z.string()).optional(),
});

export type TableDataInput = z.infer<typeof tableDataInputSchema>;
export type TableDataResult<T> = {
  rows: T[];
  total: number;
  page: number;
  pageSize: number;
  pageCount: number;
};

type Db = any;

export async function queryTableData<T extends Record<string, unknown>>(
  db: Db,
  table: unknown,
  input: TableDataInput,
  fallbackRows: T[],
  defaultSort?: { column: string; direction: "asc" | "desc" },
): Promise<TableDataResult<T>> {
  try {
    return await querySqlTableData(db, table, input, defaultSort);
  } catch (err) {
    console.error(err);
    return queryMemoryTableData(fallbackRows, input, defaultSort);
  }
}

async function querySqlTableData<T extends Record<string, unknown>>(
  db: Db,
  table: unknown,
  input: TableDataInput,
  defaultSort?: { column: string; direction: "asc" | "desc" },
): Promise<TableDataResult<T>> {
  const offset = (input.page - 1) * input.pageSize;
  const whereClause = buildWhereClause(input);
  const orderClause = buildOrderClause(input, defaultSort);
  const baseQuery = db.select().from(table).where(whereClause);
  const sortedQuery = orderClause ? baseQuery.orderBy(orderClause) : baseQuery;

  const [rows, [countRow]] = await Promise.all([
    sortedQuery.limit(input.pageSize).offset(offset),
    db.select({ count: count() }).from(table).where(whereClause),
  ]);

  const total = Number(countRow?.count ?? 0);
  return {
    rows: rows as T[],
    total,
    page: input.page,
    pageSize: input.pageSize,
    pageCount: Math.ceil(total / input.pageSize),
  };
}

function queryMemoryTableData<T extends Record<string, unknown>>(
  rows: T[],
  input: TableDataInput,
  defaultSort?: { column: string; direction: "asc" | "desc" },
): TableDataResult<T> {
  let result = [...rows];
  if (input.globalSearch && input.globalSearchColumns?.length) {
    const search = input.globalSearch.toLowerCase();
    result = result.filter((row) =>
      input.globalSearchColumns!.some((column) =>
        String(readValue(row, column) ?? "")
          .toLowerCase()
          .includes(search),
      ),
    );
  }

  for (const filter of input.filters ?? []) {
    result = result.filter((row) => matchesMemoryFilter(row, filter));
  }

  const sortColumn = input.sortColumn ?? defaultSort?.column;
  const sortDirection = input.sortDirection ?? defaultSort?.direction;
  if (sortColumn && sortDirection) {
    result.sort((a, b) => {
      const left = readValue(a, sortColumn);
      const right = readValue(b, sortColumn);
      const comparison =
        typeof left === "number" && typeof right === "number"
          ? left - right
          : String(left ?? "").localeCompare(String(right ?? ""), undefined, {
              numeric: true,
            });
      return sortDirection === "desc" ? -comparison : comparison;
    });
  }

  const total = result.length;
  const start = (input.page - 1) * input.pageSize;
  return {
    rows: result.slice(start, start + input.pageSize),
    total,
    page: input.page,
    pageSize: input.pageSize,
    pageCount: Math.ceil(total / input.pageSize),
  };
}

function buildWhereClause(input: TableDataInput) {
  const conditions: ReturnType<typeof sql>[] = [];
  for (const filter of input.filters ?? []) {
    const condition = buildFilterCondition(
      filter.column,
      filter.operator,
      filter.value,
    );
    if (condition) conditions.push(condition);
  }

  if (input.globalSearch && input.globalSearchColumns?.length) {
    const term = `%${input.globalSearch}%`;
    const parts = input.globalSearchColumns
      .map(normalizeColumnIdentifier)
      .filter((column): column is string => !!column)
      .map((column) => sql`${sql.identifier(column)}::text ilike ${term}`);
    if (parts.length) conditions.push(sql`(${joinSql(parts, "or")})`);
  }

  return conditions.length ? joinSql(conditions, "and") : undefined;
}

function buildFilterCondition(
  column: string,
  operator: string,
  value: string | number | boolean | undefined,
) {
  const normalizedColumn = normalizeColumnIdentifier(column);
  if (!normalizedColumn) return null;
  const col = sql.identifier(normalizedColumn);

  switch (operator) {
    case "eq":
      return sql`${col} = ${value ?? null}`;
    case "neq":
      return sql`${col} != ${value ?? null}`;
    case "contains":
      return sql`${col}::text ilike ${"%" + (value ?? "") + "%"}`;
    case "gt":
      return sql`${col} > ${value ?? null}`;
    case "gte":
      return sql`${col} >= ${value ?? null}`;
    case "lt":
      return sql`${col} < ${value ?? null}`;
    case "lte":
      return sql`${col} <= ${value ?? null}`;
    case "is_null":
      return sql`${col} is null`;
    case "is_not_null":
      return sql`${col} is not null`;
    default:
      return null;
  }
}

function buildOrderClause(
  input: TableDataInput,
  defaultSort?: { column: string; direction: "asc" | "desc" },
) {
  const sortColumn = normalizeColumnIdentifier(
    input.sortColumn ?? defaultSort?.column ?? "",
  );
  if (!sortColumn) return undefined;
  const direction = input.sortDirection ?? defaultSort?.direction ?? "asc";
  const col = sql.identifier(sortColumn);
  return direction === "desc"
    ? sql`${col} desc nulls last`
    : sql`${col} asc nulls first`;
}

function normalizeColumnIdentifier(column: string): string | null {
  const normalized = column.replace(
    /[A-Z]/g,
    (char) => `_${char.toLowerCase()}`,
  );
  return /^[a-z][a-z0-9_]*$/.test(normalized) ? normalized : null;
}

function joinSql(parts: ReturnType<typeof sql>[], operator: "and" | "or") {
  return parts.reduce((acc, part, index) =>
    index === 0
      ? part
      : operator === "and"
        ? sql`${acc} and ${part}`
        : sql`${acc} or ${part}`,
  );
}

function matchesMemoryFilter<T extends Record<string, unknown>>(
  row: T,
  filter: z.infer<typeof tableFilterSchema>,
): boolean {
  const actual = readValue(row, filter.column);
  const expected = filter.value;

  switch (filter.operator) {
    case "eq":
      return String(actual ?? "") === String(expected ?? "");
    case "neq":
      return String(actual ?? "") !== String(expected ?? "");
    case "contains":
      return String(actual ?? "")
        .toLowerCase()
        .includes(String(expected ?? "").toLowerCase());
    case "gt":
      return Number(actual) > Number(expected);
    case "gte":
      return Number(actual) >= Number(expected);
    case "lt":
      return Number(actual) < Number(expected);
    case "lte":
      return Number(actual) <= Number(expected);
    case "is_null":
      return actual == null || actual === "";
    case "is_not_null":
      return actual != null && actual !== "";
  }
}

function readValue(row: Record<string, unknown>, path: string): unknown {
  return path.split(".").reduce<unknown>((value, part) => {
    if (value && typeof value === "object")
      return (value as Record<string, unknown>)[part];
    return undefined;
  }, row);
}
