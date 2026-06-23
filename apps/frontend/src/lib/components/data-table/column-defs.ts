import type { DataTableColumn } from './types';
import TagsCell from './cells/tags-cell.svelte';
import BoolBadgeCell from './cells/bool-badge-cell.svelte';
import NullableTextCell from './cells/nullable-text-cell.svelte';
import RelativeDateCell from './cells/relative-date-cell.svelte';
import DateCell from '$lib/components/data-table/cells/date-cell.svelte';
import StateBadegeCell from '$lib/components/data-table/cells/state-badege-cell.svelte';

export interface BoolBadgeCellProps {
  trueLabel?: string;
  falseLabel?: string;
  falseVariant?: 'muted' | 'destructive';
  evaluate?: (value: unknown) => boolean;
}

export function stateColumn<T>(
  key: string,
  title: string,
  cellProps?: {
    transform?: (value: unknown) => string;
    evaluate?: (value: unknown) => 'info' | 'warn' | 'destructive' | 'critical' | 'success';
  },
  overrides?: Partial<DataTableColumn<T>>
): DataTableColumn<T> {
  return {
    key,
    title,
    sortable: true,
    cellComponent: StateBadegeCell,
    cellProps,
    ...overrides,
  };
}

export function tagsColumn<T>(overrides?: Partial<DataTableColumn<T>>): DataTableColumn<T> {
  return {
    key: 'tags',
    title: 'Tags',
    cellComponent: TagsCell,
    sortable: true,
    ...overrides,
  };
}

export function nullableTextColumn<T>(
  key: string,
  title: string,
  cellProps?: { pretty?: boolean },
  overrides?: Partial<DataTableColumn<T>>
): DataTableColumn<T> {
  return {
    key,
    title,
    cellComponent: NullableTextCell,
    cellProps,
    ...overrides,
  };
}

export function relativeDateColumn<T>(
  key: string,
  title: string,
  overrides?: Partial<DataTableColumn<T>>
): DataTableColumn<T> {
  return {
    key,
    title,
    cellComponent: RelativeDateCell,
    sortable: true,
    ...overrides,
  };
}

export function dateColumn<T>(
  key: string,
  title: string,
  overrides?: Partial<DataTableColumn<T>>,
  cellProps?: { withTime?: boolean }
): DataTableColumn<T> {
  return {
    key,
    title,
    cellComponent: DateCell,
    cellProps,
    sortable: true,
    ...overrides,
  };
}

export function boolBadgeColumn<T>(
  key: string,
  title: string,
  cellProps?: BoolBadgeCellProps,
  overrides?: Partial<DataTableColumn<T>>
): DataTableColumn<T> {
  return {
    key,
    title,
    cellComponent: BoolBadgeCell,
    cellProps,
    sortable: true,
    ...overrides,
  };
}

export function textColumn<T>(
  key: string,
  title: string,
  placeholder?: string,
  cellProps?: { pretty?: boolean },
  overrides?: Partial<DataTableColumn<T>>
): DataTableColumn<T> {
  return {
    key,
    title,
    sortable: true,
    searchable: true,
    cellComponent: NullableTextCell,
    cellProps,
    filter: {
      type: 'text',
      operators: ['contains', 'eq'],
      placeholder: placeholder ?? `Search ${title}...`,
    },
    ...overrides,
  };
}

export function numberColumn<T>(
  key: string,
  title: string,
  placeholder?: string,
  overrides?: Partial<DataTableColumn<T>>
): DataTableColumn<T> {
  return {
    key,
    title,
    sortable: true,
    searchable: true,
    filter: {
      type: 'number',
      operators: ['eq', 'lt', 'gt', 'lte', 'gte'],
      placeholder: placeholder ?? `Filter ${title}...`,
    },
    ...overrides,
  };
}
