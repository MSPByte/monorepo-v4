<script lang="ts">
  import { Button } from '$lib/components/ui/button';
  import { Badge } from '$lib/components/ui/badge';
  import Pencil from '@lucide/svelte/icons/pencil';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import { formatMoney } from '$lib/utils/format';

  type VendorFilter = {
    column: string;
    operator: string;
    value?: string | boolean;
  };

  type RuleScope = {
    mode: 'include' | 'exclude';
    targetType: 'site' | 'site_group' | 'all';
    siteId?: string | null;
    siteGroupId?: string | null;
  };

  type Rule = {
    id: string;
    name: string;
    enabled: boolean;
    scopes?: RuleScope[];
    psaItemMatch: { field: string; operator: string; value: string };
    vendorProvider: string;
    vendorFacet: string;
    vendorFilters: VendorFilter[];
  };

  let {
    rule,
    scopeSummary,
    facetLabel,
    matchedRows,
    mrrDelta,
    onEdit,
    onDelete,
    deletePending = false,
  }: {
    rule: Rule;
    scopeSummary: string;
    facetLabel: string;
    matchedRows?: number;
    mrrDelta?: number;
    onEdit: () => void;
    onDelete: () => void;
    deletePending?: boolean;
  } = $props();

  function formatOp(op: string) {
    switch (op) {
      case 'eq':
        return 'equals';
      case 'neq':
        return '≠';
      case 'contains':
        return 'contains';
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
  class="group relative flex flex-col gap-3 rounded-xl border bg-card p-5 shadow-sm transition-colors hover:border-primary/40"
>
  <div class="flex items-start justify-between gap-3">
    <div class="min-w-0 flex-1">
      <div class="flex items-center gap-2">
        <h4 class="break-words text-sm font-semibold">{rule.name}</h4>
        {#if !rule.enabled}
          <Badge variant="outline" class="text-[10px]">Disabled</Badge>
        {/if}
      </div>
      <div class="mt-0.5 text-xs text-muted-foreground">{scopeSummary}</div>
    </div>
    <div class="flex shrink-0">
      <Button
        variant="ghost"
        size="icon"
        class="size-7"
        onclick={onEdit}
        aria-label={`Edit ${rule.name}`}
      >
        <Pencil class="size-3.5" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        class="size-7 text-destructive hover:text-destructive"
        disabled={deletePending}
        onclick={onDelete}
        aria-label={`Delete ${rule.name}`}
      >
        <Trash2 class="size-3.5" />
      </Button>
    </div>
  </div>

  <div class="flex flex-wrap items-center gap-1.5 break-words text-xs">
    <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      PSA {rule.psaItemMatch.field === 'itemName' ? 'item name' : 'external ID'}
      {formatOp(rule.psaItemMatch.operator)}
      <span class="text-foreground">"{rule.psaItemMatch.value}"</span>
    </span>
    {#each rule.vendorFilters as f}
      <span class="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
        Inventory {f.column}
        {formatOp(f.operator)}{' '}{#if f.value != null}
          <span class="text-foreground"> {String(f.value)}</span>
        {/if}
      </span>
    {/each}
  </div>

  <div class="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3 text-xs">
    <span class="text-muted-foreground">
      {#if !rule.enabled}
        Excluded from reconciliation
      {:else if matchedRows === undefined}
        Open reconciliation to load results
      {:else if matchedRows === 0}
        No report lines yet
      {:else if matchedRows === 1}
        1 report line
      {:else}
        {matchedRows} report lines
      {/if}
    </span>
    <div class="flex items-center gap-1.5">
      {#if mrrDelta !== undefined && mrrDelta !== 0}
        <span
          class="font-mono text-[11px] font-semibold tabular-nums {mrrDelta > 0
            ? 'text-emerald-600 dark:text-emerald-400'
            : 'text-rose-600 dark:text-rose-400'}"
          title="Monthly impact across all sites"
        >
          {mrrDelta > 0 ? '+' : ''}{formatMoney(mrrDelta)}
        </span>
      {/if}
      <Badge variant="outline" class="font-mono text-[10px]">{facetLabel}</Badge>
    </div>
  </div>
</div>
