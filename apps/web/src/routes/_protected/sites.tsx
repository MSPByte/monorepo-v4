import * as React from "react"
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router"

import {
  DataTable,
  type DataTableColumn,
  type PaginationInput,
  type RowAction,
  type TableView,
} from "@/components/data-table/data-table"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"
import {
  querySitesOverview,
  type SiteOverviewRow,
} from "@/lib/sites-functions"

export const Route = createFileRoute("/_protected/sites")({
  component: SitesPage,
})

const integrations = {
  "microsoft-365": "Microsoft 365",
  "sophos-partner": "Sophos Partner",
  dattormm: "Datto RMM",
  cove: "Cove",
  mspagent: "MSP Agent",
  halopsa: "HaloPSA",
} as const

const integrationOptions = Object.entries(integrations).map(([value, label]) => ({
  value,
  label,
}))

const integrationTone: Record<string, string> = {
  "microsoft-365":
    "border-blue-500/25 bg-blue-500/10 text-blue-700 dark:text-blue-300",
  "sophos-partner":
    "border-emerald-500/25 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  dattormm:
    "border-amber-500/25 bg-amber-500/10 text-amber-700 dark:text-amber-300",
  cove: "border-violet-500/25 bg-violet-500/10 text-violet-700 dark:text-violet-300",
  mspagent: "border-cyan-500/25 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300",
  halopsa: "border-rose-500/25 bg-rose-500/10 text-rose-700 dark:text-rose-300",
}

const views: TableView<SiteOverviewRow>[] = [
  { id: "attention", label: "Needs Attention", filters: [{ field: "alertCount", operator: "gt", value: 0 }] },
  { id: "no-integrations", label: "No Integrations", filters: [{ field: "integrations", operator: "is_null", value: "" }] },
  { id: "m365", label: "M365", filters: [{ field: "integrations", operator: "eq", value: "microsoft-365" }] },
  { id: "security", label: "Security Stack", filters: [{ field: "securityStack", operator: "eq", value: true }] },
]

function SitesPage() {
  const navigate = useNavigate()

  const columns = React.useMemo<DataTableColumn<SiteOverviewRow>[]>(
    () => [
      {
        key: "name",
        title: "Name",
        sortable: true,
        filter: {
          label: "Name",
          type: "text",
          operators: ["contains", "eq", "neq"],
        },
        cell: ({ row }) => (
          <div className="min-w-52">
            <Link
              to="/sites/$siteId"
              params={{ siteId: row.id }}
              className="font-medium hover:underline"
              onClick={(event) => event.stopPropagation()}
            >
              {row.name}
            </Link>
            {row.description ? (
              <p className="mt-0.5 max-w-96 truncate text-xs text-muted-foreground">
                {row.description}
              </p>
            ) : null}
          </div>
        ),
      },
      {
        key: "description",
        title: "Description",
        defaultHidden: true,
        filter: {
          label: "Description",
          type: "text",
          operators: ["contains", "eq", "neq", "is_null", "is_not_null"],
        },
      },
      {
        key: "integrations",
        title: "Integrations",
        filter: {
          label: "Integration",
          type: "select",
          operators: ["eq", "neq", "is_null", "is_not_null"],
          options: integrationOptions,
        },
        exportValue: ({ row }) => row.integrations.map(integrationLabel).join("; "),
        cell: ({ row }) => (
          <div className="flex max-w-96 flex-wrap gap-1">
            {row.integrations.length ? (
              row.integrations.map((id) => (
                <Badge
                  key={id}
                  variant="outline"
                  className={cn("border", integrationTone[id])}
                >
                  {integrationLabel(id)}
                </Badge>
              ))
            ) : (
              <span className="text-xs text-muted-foreground">None</span>
            )}
          </div>
        ),
      },
      {
        key: "alertCount",
        title: "Alerts",
        sortable: true,
        filter: {
          label: "Alerts",
          type: "number",
          operators: ["eq", "neq", "gt", "gte", "lt", "lte"],
        },
        cell: ({ value }) => (
          <div className="text-right font-medium">
            {Number(value ?? 0).toLocaleString()}
          </div>
        ),
      },
      {
        key: "criticalCount",
        title: "Critical",
        sortable: true,
        filter: {
          label: "Critical",
          type: "number",
          operators: ["eq", "neq", "gt", "gte", "lt", "lte"],
        },
        cell: ({ value }) => (
          <div className="text-right text-destructive">
            {Number(value ?? 0).toLocaleString()}
          </div>
        ),
      },
      {
        key: "highCount",
        title: "High",
        sortable: true,
        filter: {
          label: "High",
          type: "number",
          operators: ["eq", "neq", "gt", "gte", "lt", "lte"],
        },
        cell: ({ value }) => (
          <div className="text-right">{Number(value ?? 0).toLocaleString()}</div>
        ),
      },
      {
        key: "createdAt",
        title: "Created",
        sortable: true,
        defaultHidden: true,
        cell: ({ value }) => formatDate(String(value)),
      },
      {
        key: "updatedAt",
        title: "Updated",
        sortable: true,
        defaultHidden: true,
        cell: ({ value }) => formatDate(String(value)),
      },
    ],
    [],
  )

  const rowActions = React.useMemo<RowAction<SiteOverviewRow>[]>(
    () => [
      {
        label: "Copy IDs",
        variant: "secondary",
        onclick: async (rows, _refetch, context) => {
          context.setProgress(`Copying ${rows.length} site IDs...`)
          await navigator.clipboard.writeText(rows.map((row) => row.id).join("\n"))
        },
      },
    ],
    [],
  )

  return (
    <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden p-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Sites</h1>
          <p className="text-sm text-muted-foreground">
            Review site coverage, integration links, and active alert load.
          </p>
        </div>
      </div>
      <DataTable
        columns={columns}
        views={views}
        rowActions={rowActions}
        defaultSort={{ field: "alertCount", dir: "desc" }}
        defaultPageSize={50}
        exportFileName="sites"
        fetchData={(opts: PaginationInput) => querySitesOverview({ data: opts })}
        onRowClick={(site) =>
          void navigate({ to: "/sites/$siteId", params: { siteId: site.id } })
        }
      />
    </main>
  )
}

function integrationLabel(id: string) {
  return integrations[id as keyof typeof integrations] ?? id
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value))
}
