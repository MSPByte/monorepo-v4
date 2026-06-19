<script lang="ts">
  import { Label } from "$lib/components/ui/label";
  import * as Select from "$lib/components/ui/select";
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
    <Select.Root
      type="single"
      value={operator}
      onValueChange={(v) => v && onoperatorchange(v as FilterOperator)}
    >
      <Select.Trigger class="w-full">
        <span data-slot="select-value">
          {getOperatorLabel(operator)}
        </span>
      </Select.Trigger>
      <Select.Content>
        {#each config.operators as op}
          <Select.Item value={op} label={getOperatorLabel(op)}>
            {getOperatorLabel(op)}
          </Select.Item>
        {/each}
      </Select.Content>
    </Select.Root>
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
