import type { PaginationInput } from '$lib/components/data-table';

export function toServerTableInput(input: PaginationInput, globalSearchColumns: string[]) {
  return {
    page: input.page + 1,
    pageSize: input.pageSize,
    sortColumn: input.sortField,
    sortDirection: input.sortDir,
    filters: input.filters.map((filter) => ({
      column: filter.field,
      operator: filter.operator,
      value:
        typeof filter.value === 'string' ||
        typeof filter.value === 'number' ||
        typeof filter.value === 'boolean'
          ? filter.value
          : undefined,
    })),
    globalSearch: input.globalSearch || undefined,
    globalSearchColumns,
  };
}
