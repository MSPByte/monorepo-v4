<script lang="ts">
  import { getLocalTimeZone, parseDate, today, type CalendarDate } from '@internationalized/date';
  import { Label } from '$lib/components/ui/label';
  import * as Select from '$lib/components/ui/select';
  import DatePicker from '$lib/components/date-picker.svelte';
  import type { FilterOperator, FilterConfig } from '../types';
  import { getOperatorLabel } from '../utils/filters';

  interface Props {
    config: FilterConfig;
    operator: FilterOperator;
    value: string;
    onoperatorchange: (operator: FilterOperator) => void;
    onvaluechange: (value: string) => void;
  }

  let { config, operator, value, onoperatorchange, onvaluechange }: Props = $props();

  const presets = [
    { label: '30 days ago', daysAgo: 30 },
    { label: '3 months ago', daysAgo: 90 },
    { label: '6 months ago', daysAgo: 180 },
    { label: '1 year ago', daysAgo: 365 },
  ];

  let selectedDate = $state<CalendarDate | undefined>(undefined);

  function parseValue(raw: string): CalendarDate | undefined {
    if (!raw) return undefined;
    try {
      return parseDate(raw.slice(0, 10));
    } catch {
      return undefined;
    }
  }

  function applyPreset(daysAgo: number) {
    selectedDate = today(getLocalTimeZone()).subtract({ days: daysAgo });
    onvaluechange(selectedDate.toString());
  }

  function isActivePreset(daysAgo: number): boolean {
    if (!selectedDate) return false;
    return (
      selectedDate.toString() === today(getLocalTimeZone()).subtract({ days: daysAgo }).toString()
    );
  }

  $effect(() => {
    selectedDate = parseValue(value);
  });

  $effect(() => {
    if (selectedDate && selectedDate.toString() !== value) {
      onvaluechange(selectedDate.toString());
    }
  });
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
    <Label>Quick dates</Label>
    <div class="flex flex-wrap gap-1.5">
      {#each presets as preset}
        <button
          type="button"
          onclick={() => applyPreset(preset.daysAgo)}
          class={[
            'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors cursor-pointer',
            isActivePreset(preset.daysAgo)
              ? 'bg-primary text-primary-foreground border-primary'
              : 'bg-muted/40 text-muted-foreground border-border hover:bg-muted hover:text-foreground',
          ].join(' ')}
        >
          {preset.label}
        </button>
      {/each}
    </div>
  </div>

  <div class="space-y-2">
    <DatePicker title="Date" maxValue={today(getLocalTimeZone())} bind:value={selectedDate} />
  </div>
</div>
