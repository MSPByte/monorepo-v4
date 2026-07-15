<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  type VendorFilter = {
    column: string;
    operator: string;
    value?: string | boolean;
  };

  type Rule = {
    id: string;
    name: string;
    enabled: boolean;
    siteId: string | null;
    psaItemMatch: { field: string; operator: string; value: string };
    vendorFilters: VendorFilter[];
  };

  let {
    rule,
    siteName,
    matchedRows,
    mrrDelta = 0,
    onEdit,
    onDelete,
    deletePending = false,
  }: {
    rule: Rule;
    siteName: string;
    matchedRows: number;
    mrrDelta?: number;
    onEdit: () => void;
    onDelete: () => void;
    deletePending?: boolean;
  } = $props();

  function money(value: number) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value);
  }

  function formatOp(op: string) {
    switch (op) {
      case 'eq':
        return '=';
      case 'neq':
        return '≠';
      case 'contains':
        return '~';
      case 'is_null':
        return 'is not set';
      case 'is_not_null':
        return 'is set';
      default:
        return op;
    }
  }
</script>

<div
  class="group relative flex flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:border-primary/40 hover:bg-accent/30"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h4 class="truncate text-sm font-semibold">{rule.name}</h4>
        {#if !rule.enabled}
          <Badge variant="outline" class="text-[10px]">Disabled</Badge>
        {/if}
      </div>
      <div class="mt-0.5 text-xs text-muted-foreground">{siteName}</div>
    </div>
    <div class="flex opacity-0 transition-opacity group-hover:opacity-100">
      <Button variant="ghost" size="icon" class="size-7" onclick={onEdit} aria-label="Edit rule">
        <Pencil class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-7 text-destructive hover:text-destructive"
        disabled={deletePending}
        onclick={onDelete}
        aria-label="Delete rule"
      >
        <Trash2 class="size-3.5" />
      </Button>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-1.5 text-xs">
    <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      psa.{rule.psaItemMatch.field} {formatOp(rule.psaItemMatch.operator)}
      <span class="text-foreground">"{rule.psaItemMatch.value}"</span>
    </span>
    {#each rule.vendorFilters as f}
      <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        vendor.{f.column} {formatOp(f.operator)}{#if f.value != null}
          <span class="text-foreground"> {String(f.value)}</span>
        {/if}
      </span>
    {/each}
  </div>

  <div class="flex items-center justify-between border-t pt-2 text-xs">
    <span class="text-muted-foreground">
      {#if matchedRows === 0}
        No matching PSA rows yet
      {:else if matchedRows === 1}
        1 matched row
      {:else}
        {matchedRows} matched rows
      {/if}
    </span>
    <div class="flex items-center gap-1.5">
      {#if mrrDelta !== 0}
        <span
          class="font-mono text-[11px] font-semibold tabular-nums {mrrDelta > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400'}"
          title="Total MRR impact from this rule"
        >
          {mrrDelta > 0 ? '+' : ''}{money(mrrDelta)}
        </span>
      {/if}
      <Badge variant="outline" class="font-mono text-[10px]">sophos_endpoints</Badge>
    </div>
  </div>
</div>
