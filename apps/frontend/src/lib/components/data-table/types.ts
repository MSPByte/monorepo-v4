import type { LucideProps } from '@lucide/svelte';
import type { Component, Snippet } from 'svelte';

export type FilterOperator =
  | 'eq'
  | 'neq'
  | 'lt'
  | 'lte'
  | 'gt'
  | 'gte'
  | 'contains'
  | 'is_null'
  | 'is_not_null';

export interface TableFilter {
  id: string;
  field: string;
  operator: FilterOperator;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  value: any;
}

export type FilterConfig = {
  label?: string;
  type: 'text' | 'select' | 'date' | 'number' | 'boolean';
  operators: FilterOperator[];
  defaultOperator?: FilterOperator;
  options?: { label: string; value: unknown }[];
  placeholder?: string;
  multiple?: boolean;
};

export type DataTableColumn<TData> = {
  key: string;
  title: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cell?: Snippet<[{ row: TData; value: any }]>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cellComponent?: Component<{ value: any; row?: TData; [key: string]: any }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cellProps?: Record<string, any>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  exportValue?: (context: { row: TData; value: any }) => string | number | boolean | null;
  sortable?: boolean;
  searchable?: boolean;
  hideable?: boolean;
  hidden?: boolean;
  defaultHidden?: boolean;
  width?: string;
  filter?: FilterConfig;
};

export interface TableView<TData = unknown> {
  id: string;
  label: string;
  description?: string;
  icon?: Component;
  filters: Omit<TableFilter, 'id'>[];
  sort?: { field: string; dir: 'asc' | 'desc' };
  isDefault?: boolean;
}

export interface RowActionContext {
  setProgress: (message: string | null) => void;
}

export interface RowAction<TData> {
  label: string;
  icon?: Component<LucideProps, {}, ''>;
  onclick: (
    rows: TData[],
    fetchData: () => Promise<void>,
    context: RowActionContext
  ) => void | Promise<void>;
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost';
  disabled?: (rows: TData[]) => boolean;
}

/** Options passed to the fetchData callback on every re-fetch. */
export type PaginationInput = {
  page: number;
  pageSize: number;
  globalSearch: string;
  filters: TableFilter[];
  sortField?: string;
  sortDir?: 'asc' | 'desc';
};

export interface DataTableProps<TData> {
  fetchData: (opts: PaginationInput) => Promise<{ rows: TData[]; total: number }>;
  columns: DataTableColumn<TData>[];
  loading?: boolean;

  // Features
  enableRowSelection?: boolean;
  enableGlobalSearch?: boolean;
  enableFilters?: boolean;
  enablePagination?: boolean;
  enableColumnToggle?: boolean;
  enableExport?: boolean;
  enableURLState?: boolean;

  // Config
  views?: TableView<TData>[];
  rowActions?: RowAction<TData>[];
  globalSearchFields?: string[];
  filterMap?: Record<string, string>;
  defaultPageSize?: number;
  defaultSort?: { field: string; dir: 'asc' | 'desc' };

  // Bump to force a re-fetch from outside
  refreshKey?: number;

  // Events
  onrowclick?: (row: TData) => void;
  onselectionchange?: (rows: TData[]) => void;
}

export interface DataTableState {
  page: number;
  pageSize: number;
  globalSearch: string;
  filters: TableFilter[];
  activeViewId?: string;
  sorting: Record<string, 'asc' | 'desc'>;
  selectedRows: Set<string>;
  visibleColumns: Set<string>;
}
