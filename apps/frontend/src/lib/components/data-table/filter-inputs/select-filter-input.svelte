<script lang="ts">
  import { Label } from "$lib/components/ui/label";
  import type { FilterOperator, FilterConfig } from "../types";
  import { getOperatorLabel } from "../utils/filters";
  import SingleSelect from "$lib/components/single-select.svelte";

  interface Props {
    config: FilterConfig;
    operator: FilterOperator;
    value: any;
    onoperatorchange: (operator: FilterOperator) => void;
    onvaluechange: (value: any) => void;
  }

  let {
    config,
    operator,
    value,
    onoperatorchange,
    onvaluechange,
  }: Props = $props();
</script>

<div class="space-y-4">
  <div class="space-y-2">
    <Label>Operator</Label>
    <SingleSelect aria-label="Filter operator" allowClear={false} options={config.operators.map(op => ({value: op, label: getOperatorLabel(op)}))} selected={operator} onchange={(v) => v && onoperatorchange(v as FilterOperator)} />
  </div>

  <div class="space-y-2">
    <Label>Value</Label>
    <SingleSelect
      options={config.options?.map((o) => ({ ...o, value: String(o.value) })) ?? []}
      selected={String(value || '')}
      placeholder="Select value..."
      onchange={(v) => onvaluechange(v)}
    />
  </div>
</div>
