import * as React from "react"
import {
  ArrowDown,
  ArrowUp,
  ChevronsUpDown,
  Columns3,
  Download,
  FileDown,
  Filter,
  LoaderCircle,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react"
import * as XLSX from "xlsx"

import { Loader } from "@/components/loader"
import { SingleSelect } from "@/components/single-select"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { cn } from "@/lib/utils"

export type FilterOperator =
  | "eq"
  | "neq"
  | "lt"
  | "lte"
  | "gt"
  | "gte"
  | "contains"
  | "is_null"
  | "is_not_null"

export type TableFilter = {
  id: string
  field: string
  operator: FilterOperator
  value: unknown
}

export type FilterConfig = {
  label?: string
  type: "text" | "select" | "date" | "number" | "boolean"
  operators: FilterOperator[]
  defaultOperator?: FilterOperator
  options?: { label: string; value: string }[]
  placeholder?: string
}

export type DataTableColumn<TData> = {
  key: string
  title: string
  cell?: (context: { row: TData; value: unknown }) => React.ReactNode
  exportValue?: (context: {
    row: TData
    value: unknown
  }) => string | number | boolean | null | undefined
  sortable?: boolean
  searchable?: boolean
  hideable?: boolean
  hidden?: boolean
  defaultHidden?: boolean
  width?: string
  filter?: FilterConfig
}

export type TableView<TData = unknown> = {
  id: string
  label: string
  description?: string
  filters: Omit<TableFilter, "id">[]
  sort?: { field: string; dir: "asc" | "desc" }
  isDefault?: boolean
  predicate?: (row: TData) => boolean
}

export type PaginationInput = {
  page: number
  pageSize: number
  globalSearch: string
  filters: TableFilter[]
  sortField?: string
  sortDir?: "asc" | "desc"
}

export type RowActionContext = {
  setProgress: (message: string | null) => void
}

export type RowAction<TData> = {
  label: string
  onclick: (
    rows: TData[],
    refetch: () => Promise<void>,
    context: RowActionContext
  ) => void | Promise<void>
  variant?: "default" | "destructive" | "outline" | "secondary" | "ghost"
  disabled?: (rows: TData[]) => boolean
}

export type DataTableProps<TData> = {
  fetchData: (
    opts: PaginationInput
  ) => Promise<{ rows: TData[]; total: number }>
  columns: DataTableColumn<TData>[]
  rowActions?: RowAction<TData>[]
  views?: TableView<TData>[]
  defaultPageSize?: number
  defaultSort?: { field: string; dir: "asc" | "desc" }
  exportFileName: string
  getRowId?: (row: TData) => string
  onRowClick?: (row: TData) => void
}

export function DataTable<TData>({
  fetchData,
  columns,
  rowActions = [],
  views = [],
  defaultPageSize = 50,
  defaultSort,
  exportFileName,
  getRowId = (row) =>
    String((row as { id?: string }).id ?? JSON.stringify(row)),
  onRowClick,
}: DataTableProps<TData>) {
  const defaultView = views.find((view) => view.isDefault)
  const [data, setData] = React.useState<TData[]>([])
  const [total, setTotal] = React.useState(0)
  const [loading, setLoading] = React.useState(true)
  const [page, setPage] = React.useState(0)
  const [pageSize, setPageSize] = React.useState(defaultPageSize)
  const [globalSearch, setGlobalSearch] = React.useState("")
  const [filters, setFilters] = React.useState<TableFilter[]>([])
  const [activeViewId, setActiveViewId] = React.useState<string | undefined>(
    defaultView?.id
  )
  const [sortField, setSortField] = React.useState<string | undefined>(
    defaultView?.sort?.field ?? defaultSort?.field
  )
  const [sortDir, setSortDir] = React.useState<"asc" | "desc" | undefined>(
    defaultView?.sort?.dir ?? defaultSort?.dir
  )
  const [visibleColumns, setVisibleColumns] = React.useState(
    () =>
      new Set(
        columns
          .filter((column) => !column.hidden && !column.defaultHidden)
          .map((column) => column.key)
      )
  )
  const [selectedRowIds, setSelectedRowIds] = React.useState<Set<string>>(
    new Set()
  )
  const [allSelected, setAllSelected] = React.useState(false)
  const [filterDialogOpen, setFilterDialogOpen] = React.useState(false)
  const [exportDialogOpen, setExportDialogOpen] = React.useState(false)
  const [pendingExportFormat, setPendingExportFormat] = React.useState<
    "csv" | "xlsx" | null
  >(null)
  const [confirmDialogOpen, setConfirmDialogOpen] = React.useState(false)
  const [pendingAction, setPendingAction] =
    React.useState<RowAction<TData> | null>(null)
  const [pendingActionRows, setPendingActionRows] = React.useState<TData[]>([])
  const [actionRunning, setActionRunning] = React.useState(false)
  const [activeAction, setActiveAction] =
    React.useState<RowAction<TData> | null>(null)
  const [actionProgress, setActionProgress] = React.useState<string | null>(
    null
  )

  const activeView = views.find((view) => view.id === activeViewId)
  const viewFilters = React.useMemo<TableFilter[]>(
    () =>
      activeView?.filters.map((filter) => ({
        ...filter,
        id: `view-${filter.field}-${filter.operator}`,
      })) ?? [],
    [activeView]
  )
  const allFilters = React.useMemo(
    () => [...filters, ...viewFilters],
    [filters, viewFilters]
  )
  const displayColumns = columns.filter(
    (column) => !column.hidden && visibleColumns.has(column.key)
  )
  const toggleableColumns = columns.filter((column) => !column.hidden)
  const selectedRows = data.filter((row) => selectedRowIds.has(getRowId(row)))
  const selectionCount = allSelected ? total : selectedRowIds.size
  const allPageSelected =
    data.length > 0 && data.every((row) => selectedRowIds.has(getRowId(row)))
  const somePageSelected =
    data.some((row) => selectedRowIds.has(getRowId(row))) && !allPageSelected
  const pageCount = Math.max(Math.ceil(total / pageSize), 1)

  const request = React.useMemo<PaginationInput>(
    () => ({
      page,
      pageSize,
      globalSearch,
      filters: allFilters,
      sortField,
      sortDir,
    }),
    [allFilters, globalSearch, page, pageSize, sortDir, sortField]
  )

  const refetch = React.useCallback(async () => {
    if (!actionRunning) setLoading(true)
    try {
      const result = await fetchData(request)
      setData(result.rows)
      setTotal(result.total)
      const nextPageCount = Math.max(Math.ceil(result.total / pageSize), 1)
      if (page >= nextPageCount) setPage(0)
    } finally {
      if (!actionRunning) setLoading(false)
    }
  }, [actionRunning, fetchData, page, pageSize, request])

  React.useEffect(() => {
    void refetch()
  }, [refetch])

  function handleSort(columnKey: string) {
    if (actionRunning) return
    setPage(0)
    if (sortField === columnKey) {
      if (sortDir === "asc") setSortDir("desc")
      else if (sortDir === "desc") {
        setSortField(undefined)
        setSortDir(undefined)
      } else setSortDir("asc")
    } else {
      setSortField(columnKey)
      setSortDir("asc")
    }
  }

  function handleTogglePageRows(checked: boolean) {
    if (actionRunning) return
    if (!checked) {
      setAllSelected(false)
      setSelectedRowIds(new Set())
      return
    }

    setSelectedRowIds((current) => {
      const next = new Set(current)
      for (const row of data) next.add(getRowId(row))
      return next
    })
  }

  function handleToggleRow(row: TData, checked: boolean) {
    if (actionRunning) return
    setAllSelected(false)
    setSelectedRowIds((current) => {
      const next = new Set(current)
      if (checked) next.add(getRowId(row))
      else next.delete(getRowId(row))
      return next
    })
  }

  async function resolveActionRows() {
    if (!allSelected) return selectedRows

    setActionProgress(`Preparing ${total} selected rows...`)
    const rows: TData[] = []
    const batchSize = 1000
    const pageCount = Math.ceil(total / batchSize)
    for (let nextPage = 0; nextPage < pageCount; nextPage++) {
      const result = await fetchData({
        ...request,
        page: nextPage,
        pageSize: batchSize,
      })
      rows.push(...result.rows)
    }
    return rows
  }

  async function executeAction(action: RowAction<TData>, rows: TData[]) {
    setActionRunning(true)
    setActiveAction(action)
    setActionProgress(
      `${action.label} for ${rows.length} row${rows.length === 1 ? "" : "s"}...`
    )
    try {
      await action.onclick(rows, refetch, { setProgress: setActionProgress })
      setAllSelected(false)
      setSelectedRowIds(new Set())
    } finally {
      setActionRunning(false)
      setActiveAction(null)
      setActionProgress(null)
    }
  }

  async function handleAction(action: RowAction<TData>) {
    if (actionRunning) return
    setActionRunning(true)
    setActiveAction(action)
    setActionProgress("Preparing selected rows...")
    let rows: TData[]
    try {
      rows = await resolveActionRows()
    } finally {
      setActionRunning(false)
      setActiveAction(null)
      setActionProgress(null)
    }

    if (action.variant === "destructive") {
      setPendingAction(action)
      setPendingActionRows(rows)
      setConfirmDialogOpen(true)
      return
    }

    await executeAction(action, rows)
  }

  async function executeExport(scope: "visible" | "all") {
    setExportDialogOpen(false)
    if (!pendingExportFormat) return
    const result = await fetchData({
      ...request,
      page: 0,
      pageSize: total || 10000,
    })
    const keys = scope === "visible" ? visibleColumns : undefined
    if (pendingExportFormat === "csv") {
      exportCsv(result.rows, columns, exportFileName, keys)
    } else {
      exportXlsx(result.rows, columns, exportFileName, keys)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
          <SingleSelect
            value={activeViewId ?? "all"}
            onValueChange={(value) => {
              const view = views.find((item) => item.id === value)
              setActiveViewId(value === "all" ? undefined : value)
              setSortField(view?.sort?.field ?? defaultSort?.field)
              setSortDir(view?.sort?.dir ?? defaultSort?.dir)
              setAllSelected(false)
              setSelectedRowIds(new Set())
              setPage(0)
            }}
            options={[
              { label: "All", value: "all" },
              ...views.map((view) => ({ label: view.label, value: view.id })),
            ]}
            placeholder="View"
            searchPlaceholder="Search views..."
            className="w-48"
          />
          <div className="relative min-w-64 flex-1 sm:max-w-sm">
            <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={globalSearch}
              onChange={(event) => {
                setGlobalSearch(event.target.value)
                setAllSelected(false)
                setSelectedRowIds(new Set())
                setPage(0)
              }}
              className="pl-8"
              placeholder="Search rows"
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" onClick={() => setFilterDialogOpen(true)}>
            <Filter />
            Filters
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Columns3 />
                Columns
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-48">
              <DropdownMenuLabel>Visible columns</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {toggleableColumns.map((column) => (
                <DropdownMenuCheckboxItem
                  key={column.key}
                  checked={visibleColumns.has(column.key)}
                  onCheckedChange={(checked) => {
                    setVisibleColumns((current) => {
                      const next = new Set(current)
                      if (checked) next.add(column.key)
                      else next.delete(column.key)
                      return next
                    })
                  }}
                >
                  {column.title}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline">
                <Download />
                Export
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuItem
                onClick={() => {
                  setPendingExportFormat("csv")
                  setExportDialogOpen(true)
                }}
              >
                <FileDown />
                CSV
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => {
                  setPendingExportFormat("xlsx")
                  setExportDialogOpen(true)
                }}
              >
                <FileDown />
                XLSX
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {filters.length > 0 || viewFilters.length > 0 ? (
        <div className="flex flex-wrap gap-1.5">
          {[...filters, ...viewFilters].map((filter) => (
            <Badge key={filter.id} variant="outline" className="gap-1.5">
              <SlidersHorizontal className="size-3" />
              {filterLabel(filter, columns)}
              {!filter.id.startsWith("view-") ? (
                <button
                  type="button"
                  className="rounded-full text-muted-foreground hover:text-foreground"
                  onClick={() => {
                    setFilters((current) =>
                      current.filter((item) => item.id !== filter.id)
                    )
                    setAllSelected(false)
                    setSelectedRowIds(new Set())
                    setPage(0)
                  }}
                  aria-label={`Remove ${filterLabel(filter, columns)}`}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </Badge>
          ))}
          {filters.length > 0 ? (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setFilters([])
                setAllSelected(false)
                setSelectedRowIds(new Set())
                setPage(0)
              }}
            >
              Clear
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-md border bg-card/10">
        <div
          className={cn(
            "flex size-full transition-[filter,opacity]",
            actionRunning && "pointer-events-none opacity-60 blur-[2px]"
          )}
          aria-busy={actionRunning}
        >
          {loading ? (
            <Loader />
          ) : (
            <div className="size-full overflow-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 z-10 w-10 bg-background">
                      <Checkbox
                        checked={
                          allPageSelected ||
                          (somePageSelected && "indeterminate")
                        }
                        onCheckedChange={(value) =>
                          handleTogglePageRows(Boolean(value))
                        }
                        disabled={actionRunning}
                        aria-label="Select page rows"
                      />
                    </TableHead>
                    {displayColumns.map((column) => (
                      <TableHead
                        key={column.key}
                        className="sticky top-0 z-10 bg-background"
                        style={
                          column.width ? { width: column.width } : undefined
                        }
                      >
                        {column.sortable ? (
                          <button
                            type="button"
                            className="flex items-center gap-2 hover:text-foreground"
                            onClick={() => handleSort(column.key)}
                            disabled={actionRunning}
                          >
                            {column.title}
                            {sortField === column.key ? (
                              sortDir === "asc" ? (
                                <ArrowUp className="size-4" />
                              ) : (
                                <ArrowDown className="size-4" />
                              )
                            ) : (
                              <ChevronsUpDown className="size-4 opacity-30" />
                            )}
                          </button>
                        ) : (
                          column.title
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.length ? (
                    data.map((row) => {
                      const rowId = getRowId(row)
                      const isSelected = selectedRowIds.has(rowId)
                      return (
                        <TableRow
                          key={rowId}
                          data-state={isSelected ? "selected" : undefined}
                          className={cn(onRowClick && "cursor-pointer")}
                          onClick={(event) => {
                            if (
                              !onRowClick ||
                              (event.target as HTMLElement).closest("button") ||
                              (event.target as HTMLElement).closest(
                                "[data-slot='checkbox']"
                              )
                            ) {
                              return
                            }
                            onRowClick(row)
                          }}
                        >
                          <TableCell className="w-10">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={(value) =>
                                handleToggleRow(row, Boolean(value))
                              }
                              disabled={actionRunning}
                              aria-label="Select row"
                            />
                          </TableCell>
                          {displayColumns.map((column) => {
                            const value = getNestedValue(row, column.key)
                            return (
                              <TableCell key={column.key}>
                                {column.cell
                                  ? column.cell({ row, value })
                                  : String(value ?? "")}
                              </TableCell>
                            )
                          })}
                        </TableRow>
                      )
                    })
                  ) : (
                    <TableRow>
                      <TableCell
                        colSpan={displayColumns.length + 1}
                        className="h-24 text-center text-muted-foreground"
                      >
                        No results.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
        {actionRunning ? (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/35 backdrop-blur-sm">
            <Loader>
              {actionProgress ? (
                <div className="max-w-sm px-4 text-center text-sm font-medium text-muted-foreground">
                  {actionProgress}
                </div>
              ) : null}
            </Loader>
          </div>
        ) : null}
      </div>

      {selectionCount > 0 && rowActions.length > 0 ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-muted bg-muted/50 p-2">
          <span className="text-sm font-medium">
            {selectionCount} row{selectionCount === 1 ? "" : "s"} selected
            {allSelected ? (
              <Button
                variant="ghost"
                size="sm"
                className="ml-2"
                onClick={() => {
                  setAllSelected(false)
                  setSelectedRowIds(new Set())
                }}
                disabled={actionRunning}
              >
                Clear selection
              </Button>
            ) : allPageSelected && total > data.length ? (
              <>
                <span className="mr-2 text-muted-foreground">
                  {" "}
                  of {total} total
                </span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setAllSelected(true)}
                  disabled={actionRunning}
                >
                  Select all {total} rows
                </Button>
              </>
            ) : null}
          </span>
          <div className="flex gap-2">
            {rowActions.map((action) => (
              <Button
                key={action.label}
                variant={action.variant ?? "outline"}
                size="sm"
                onClick={() => void handleAction(action)}
                disabled={
                  actionRunning ||
                  (!allSelected && action.disabled
                    ? action.disabled(selectedRows)
                    : false)
                }
              >
                {actionRunning && activeAction === action ? (
                  <LoaderCircle className="mr-2 size-4 animate-spin" />
                ) : null}
                {action.label}
              </Button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm text-muted-foreground">
        <div>
          Showing {data.length} of {total} rows
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(pageSize)}
            onValueChange={(value) => {
              setPageSize(Number(value))
              setPage(0)
              setAllSelected(false)
              setSelectedRowIds(new Set())
            }}
          >
            <SelectTrigger size="sm" className="w-24">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[10, 25, 50, 100].map((size) => (
                <SelectItem key={size} value={String(size)}>
                  {size} rows
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="whitespace-nowrap">
            Page {page + 1} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage((current) => Math.max(current - 1, 0))}
            disabled={page <= 0 || actionRunning}
          >
            Previous
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              setPage((current) => Math.min(current + 1, pageCount - 1))
            }
            disabled={page >= pageCount - 1 || actionRunning}
          >
            Next
          </Button>
        </div>
      </div>

      <FilterDialog
        open={filterDialogOpen}
        onOpenChange={setFilterDialogOpen}
        columns={columns}
        onAddFilter={(filter) => {
          setFilters((current) => [...current, filter])
          setAllSelected(false)
          setSelectedRowIds(new Set())
          setPage(0)
        }}
      />

      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>
              Export {pendingExportFormat?.toUpperCase()}
            </DialogTitle>
            <DialogDescription>
              Choose which columns to include in the export.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => void executeExport("visible")}
            >
              Visible columns
            </Button>
            <Button onClick={() => void executeExport("all")}>
              All columns
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pendingAction?.label ?? "Confirm"}</DialogTitle>
            <DialogDescription>
              Are you sure you want to {pendingAction?.label.toLowerCase()}{" "}
              {pendingActionRows.length}{" "}
              {pendingActionRows.length === 1 ? "row" : "rows"}?
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              disabled={actionRunning}
              onClick={() => setConfirmDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={actionRunning || !pendingAction}
              onClick={() => {
                if (pendingAction)
                  void executeAction(pendingAction, pendingActionRows)
                setConfirmDialogOpen(false)
              }}
            >
              {actionRunning ? (
                <LoaderCircle className="mr-2 size-4 animate-spin" />
              ) : null}
              {actionRunning
                ? "Processing..."
                : (pendingAction?.label ?? "Confirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function FilterDialog<TData>({
  open,
  onOpenChange,
  columns,
  onAddFilter,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  columns: DataTableColumn<TData>[]
  onAddFilter: (filter: TableFilter) => void
}) {
  const filterableColumns = columns.filter((column) => column.filter)
  const [field, setField] = React.useState("")
  const selectedColumn = filterableColumns.find(
    (column) => column.key === field
  )
  const filterConfig = selectedColumn?.filter
  const [operator, setOperator] = React.useState<FilterOperator>("eq")
  const [value, setValue] = React.useState("")

  function handleFieldChange(nextField: string) {
    const column = filterableColumns.find((item) => item.key === nextField)
    setField(nextField)
    setOperator(
      column?.filter?.defaultOperator ??
        getDefaultOperator(column?.filter?.type)
    )
    setValue(column?.filter?.type === "boolean" ? "false" : "")
  }

  function addFilter() {
    if (!field || !filterConfig) return
    if (!["is_null", "is_not_null"].includes(operator) && value === "") return
    onAddFilter({
      id: crypto.randomUUID(),
      field,
      operator,
      value: coerceFilterValue(value, filterConfig.type),
    })
    setField("")
    setOperator("eq")
    setValue("")
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Filter</DialogTitle>
          <DialogDescription>
            Create a new filter to narrow down your results.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-2">
            <label className="text-sm font-medium">Field</label>
            <SingleSelect
              value={field}
              onValueChange={handleFieldChange}
              options={filterableColumns.map((column) => ({
                label: column.filter?.label ?? column.title,
                value: column.key,
              }))}
            />
          </div>
          {field && filterConfig ? (
            <>
              <div className="space-y-2">
                <label className="text-sm font-medium">Operator</label>
                <Select
                  value={operator}
                  onValueChange={(next) => setOperator(next as FilterOperator)}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filterConfig.operators.map((item) => (
                      <SelectItem key={item} value={item}>
                        {operatorLabel(item)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {!["is_null", "is_not_null"].includes(operator) ? (
                <div className="space-y-2">
                  <label className="text-sm font-medium">Value</label>
                  <FilterInput
                    config={filterConfig}
                    value={value}
                    onChange={setValue}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={addFilter}
            disabled={
              !field ||
              (!["is_null", "is_not_null"].includes(operator) && value === "")
            }
          >
            Add Filter
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function FilterInput({
  config,
  value,
  onChange,
}: {
  config: FilterConfig
  value: string
  onChange: (value: string) => void
}) {
  if (config.type === "select" || config.type === "boolean") {
    const options =
      config.type === "boolean"
        ? [
            { label: "True", value: "true" },
            { label: "False", value: "false" },
          ]
        : (config.options ?? [])
    return (
      <SingleSelect
        value={value}
        onValueChange={onChange}
        options={options}
        placeholder={config.placeholder ?? "Select value..."}
      />
    )
  }

  return (
    <Input
      type={
        config.type === "number"
          ? "number"
          : config.type === "date"
            ? "date"
            : "text"
      }
      value={value}
      onChange={(event) => onChange(event.target.value)}
      placeholder={config.placeholder}
    />
  )
}

function getDefaultOperator(type?: FilterConfig["type"]): FilterOperator {
  if (type === "number" || type === "date") return "eq"
  if (type === "boolean") return "eq"
  return "contains"
}

function coerceFilterValue(value: string, type: FilterConfig["type"]) {
  if (type === "number") return Number(value)
  if (type === "boolean") return value === "true"
  return value
}

function filterLabel<TData>(
  filter: TableFilter,
  columns: DataTableColumn<TData>[]
) {
  const column = columns.find((item) => item.key === filter.field)
  const option =
    column?.filter?.options?.find((item) => item.value === String(filter.value))
      ?.label ?? String(filter.value ?? "")
  return `${column?.filter?.label ?? column?.title ?? filter.field} ${operatorLabel(
    filter.operator
  )}${["is_null", "is_not_null"].includes(filter.operator) ? "" : ` ${option}`}`
}

function operatorLabel(operator: FilterOperator) {
  const labels: Record<FilterOperator, string> = {
    eq: "equals",
    neq: "does not equal",
    lt: "less than",
    lte: "less than or equal",
    gt: "greater than",
    gte: "greater than or equal",
    contains: "contains",
    is_null: "is empty",
    is_not_null: "is not empty",
  }
  return labels[operator]
}

function getNestedValue(row: unknown, path: string) {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object") {
      return (current as Record<string, unknown>)[key]
    }
    return undefined
  }, row)
}

function exportCsv<TData>(
  rows: TData[],
  columns: DataTableColumn<TData>[],
  fileName: string,
  visibleColumns?: Set<string>
) {
  const exportable = exportableColumns(columns, visibleColumns)
  const csv = [
    exportable.map((column) => column.title).join(","),
    ...rows.map((row) =>
      exportable
        .map(
          (column) =>
            `"${String(exportValue(row, column)).replaceAll('"', '""')}"`
        )
        .join(",")
    ),
  ].join("\n")
  downloadFile(
    new Blob([csv], { type: "text/csv;charset=utf-8" }),
    `${fileName}.csv`
  )
}

function exportXlsx<TData>(
  rows: TData[],
  columns: DataTableColumn<TData>[],
  fileName: string,
  visibleColumns?: Set<string>
) {
  const exportable = exportableColumns(columns, visibleColumns)
  const worksheet = XLSX.utils.aoa_to_sheet([
    exportable.map((column) => column.title),
    ...rows.map((row) => exportable.map((column) => exportValue(row, column))),
  ])
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, "Export")
  XLSX.writeFile(workbook, `${fileName}.xlsx`)
}

function exportableColumns<TData>(
  columns: DataTableColumn<TData>[],
  visibleColumns?: Set<string>
) {
  return columns.filter(
    (column) =>
      !column.hidden && (!visibleColumns || visibleColumns.has(column.key))
  )
}

function exportValue<TData>(row: TData, column: DataTableColumn<TData>) {
  const value = getNestedValue(row, column.key)
  return column.exportValue ? column.exportValue({ row, value }) : value
}

function downloadFile(blob: Blob, filename: string) {
  const href = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = href
  link.download = filename
  link.click()
  URL.revokeObjectURL(href)
}
