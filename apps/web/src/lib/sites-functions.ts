import { sitesOverview } from "@mspbyte/drizzle"
import { getTenantServiceDbByOrgId } from "@mspbyte/drizzle-catalog"
import { createServerFn } from "@tanstack/react-start"
import { getRequestHeaders } from "@tanstack/react-start/server"
import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  gte,
  ilike,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm"

import { auth } from "@/lib/auth"

export type SiteOverviewRow = typeof sitesOverview.$inferSelect
export type SitesFilter = {
  id: string
  field: string
  operator:
    | "eq"
    | "neq"
    | "lt"
    | "lte"
    | "gt"
    | "gte"
    | "contains"
    | "is_null"
    | "is_not_null"
  value: unknown
}

export type SitesQueryInput = {
  page: number
  pageSize: number
  globalSearch: string
  filters: SitesFilter[]
  sortField?: string
  sortDir?: "asc" | "desc"
}

const defaultInput: SitesQueryInput = {
  page: 0,
  pageSize: 50,
  globalSearch: "",
  filters: [],
  sortField: "alertCount",
  sortDir: "desc",
}

export const querySitesOverview = createServerFn({ method: "POST" })
  .validator((data: SitesQueryInput) => ({
    ...defaultInput,
    ...data,
    page: Math.max(Number(data.page) || 0, 0),
    pageSize: Math.min(Math.max(Number(data.pageSize) || 50, 1), 1000),
    filters: Array.isArray(data.filters) ? data.filters : [],
  }))
  .handler(async ({ data }) => {
    const headers = getRequestHeaders()
    const session = await auth.api.getSession({ headers })
    const orgId = session?.session.activeOrganizationId

    if (!orgId) {
      throw new Error("Active organization is required")
    }

    const tenant = await getTenantServiceDbByOrgId(
      orgId,
      requiredEnv("ENCRYPTION_KEY"),
      requiredEnv("CATALOG_DATABASE_URL"),
    )

    if (!tenant || tenant.org.status !== "active") {
      throw new Error("Active tenant database is required")
    }

    const where = buildWhere(data)
    const order = buildOrder(data)

    const rowsQuery = tenant.db
      .select()
      .from(sitesOverview)
      .$dynamic()
      .limit(data.pageSize)
      .offset(data.page * data.pageSize)
      .orderBy(order)

    const totalQuery = tenant.db
      .select({ total: count() })
      .from(sitesOverview)
      .$dynamic()

    if (where) {
      rowsQuery.where(where)
      totalQuery.where(where)
    }

    const [rows, totalRows] = await Promise.all([rowsQuery, totalQuery])

    return {
      rows,
      total: totalRows[0]?.total ?? 0,
    }
  })

function buildWhere(input: SitesQueryInput) {
  const conditions: SQL[] = []

  if (input.globalSearch.trim()) {
    const search = `%${input.globalSearch.trim()}%`
    conditions.push(
      or(
        ilike(sitesOverview.name, search),
        ilike(sitesOverview.description, search),
        sql`exists (
          select 1
          from unnest(${sitesOverview.integrations}) as integration
          where integration ilike ${search}
        )`,
      )!,
    )
  }

  for (const filter of input.filters) {
    const condition = buildFilterCondition(filter)
    if (condition) conditions.push(condition)
  }

  return conditions.length ? and(...conditions) : undefined
}

function buildFilterCondition(filter: SitesFilter): SQL | undefined {
  if (filter.field === "securityStack") {
    return or(
      sql`${sitesOverview.integrations} @> array[${"sophos-partner"}]::text[]`,
      sql`${sitesOverview.integrations} @> array[${"cove"}]::text[]`,
    )
  }

  if (filter.field === "integrations") {
    const value = String(filter.value)
    if (filter.operator === "neq") {
      return sql`not (${sitesOverview.integrations} @> array[${value}]::text[])`
    }
    if (filter.operator === "is_null") {
      return sql`cardinality(${sitesOverview.integrations}) = 0`
    }
    if (filter.operator === "is_not_null") {
      return sql`cardinality(${sitesOverview.integrations}) > 0`
    }
    return sql`${sitesOverview.integrations} @> array[${value}]::text[]`
  }

  const column = siteColumn(filter.field)
  if (!column) return undefined

  if (filter.operator === "is_null") return isNull(column)
  if (filter.operator === "is_not_null") return isNotNull(column)

  if (filter.field === "name" || filter.field === "description") {
    const value = String(filter.value)
    if (filter.operator === "contains") return ilike(column, `%${value}%`)
    if (filter.operator === "neq") return ne(column, value)
    return eq(column, value)
  }

  const value = Number(filter.value)
  if (Number.isNaN(value)) return undefined
  if (filter.operator === "gt") return gt(column, value)
  if (filter.operator === "gte") return gte(column, value)
  if (filter.operator === "lt") return lt(column, value)
  if (filter.operator === "lte") return lte(column, value)
  if (filter.operator === "neq") return ne(column, value)
  return eq(column, value)
}

function buildOrder(input: SitesQueryInput) {
  const column = siteColumn(input.sortField ?? "alertCount") ?? sitesOverview.alertCount
  return input.sortDir === "asc" ? asc(column) : desc(column)
}

function siteColumn(field: string | undefined) {
  if (field === "name") return sitesOverview.name
  if (field === "description") return sitesOverview.description
  if (field === "alertCount") return sitesOverview.alertCount
  if (field === "criticalCount") return sitesOverview.criticalCount
  if (field === "highCount") return sitesOverview.highCount
  if (field === "createdAt") return sitesOverview.createdAt
  if (field === "updatedAt") return sitesOverview.updatedAt
  return undefined
}

function requiredEnv(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}
