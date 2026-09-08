<script lang="ts">
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import * as Sheet from '$lib/components/ui/sheet/index.js';

  type RecordRow = Record<string, unknown>;

  interface Props {
    open: boolean;
    row: RecordRow | null;
    columns: DataTableColumn<RecordRow>[];
    title: string;
    description?: string;
    onOpenChange: (open: boolean) => void;
  }

  let { open, row, columns, title, description, onOpenChange }: Props = $props();

  function displayValue(value: unknown): string {
    if (value === null || value === undefined || value === '') return '—';
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    if (Array.isArray(value)) return value.length ? value.map(displayValue).join(', ') : '—';
    if (typeof value === 'object') return JSON.stringify(value);
    return String(value);
  }
</script>

<Sheet.Root {open} {onOpenChange}>
  <Sheet.Content side="right" class="w-80 flex flex-col p-0">
    {#if row}
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{title}</Sheet.Title>
        {#if description}
          <Sheet.Description class="mt-1">{description}</Sheet.Description>
        {/if}
      </Sheet.Header>

      <div class="flex-1 overflow-y-auto p-4 flex flex-col gap-2.5">
        <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Details</div>
        {#each columns as column}
          <div class="flex justify-between text-xs gap-2">
            <span class="text-muted-foreground shrink-0">{column.title}</span>
            <span class="font-medium text-right break-words max-w-[60%]">
              {displayValue(row[column.key])}
            </span>
          </div>
        {/each}
      </div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
