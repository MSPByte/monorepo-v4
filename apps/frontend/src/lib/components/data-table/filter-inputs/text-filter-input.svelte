<script lang="ts">
  import SingleSelect from "$lib/components/single-select.svelte";
  import { Label } from "$lib/components/ui/label";
  import { Input } from "$lib/components/ui/input";
  import type { FilterOperator, FilterConfig } from "../types";
  import { getOperatorLabel } from "../utils/filters";

  interface Props {
    config: FilterConfig;
    operator: FilterOperator;
    value: string;
    onoperatorchange: (operator: FilterOperator) => void;
    onvaluechange: (value: string) => void;
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
    <Input
      placeholder={config.placeholder || "Enter value..."}
      {value}
      oninput={(e) => onvaluechange(e.currentTarget.value)}
    />
  </div>
</div>
