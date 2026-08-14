<script lang="ts">
  import { onMount } from 'svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import type { FieldReference } from '@mspbyte/shared';

  let {
    ref,
    selected = $bindable<string | undefined>(undefined),
    onchange,
    placeholder = 'Select value...',
    class: className = '',
    disabled,
    limit = 200,
  }: {
    ref: FieldReference;
    selected?: string;
    onchange?: (v: string) => void;
    placeholder?: string;
    class?: string;
    disabled?: boolean;
    limit?: number;
  } = $props();

  let options = $state<{ value: string; label: string }[]>([]);

  function buildUrl(exactValue?: string): string {
    const params = new URLSearchParams({
      table: ref.table,
      valueColumn: ref.valueColumn,
      labelColumn: ref.labelColumn,
      limit: String(limit),
    });
    if (exactValue !== undefined) params.set('exactValue', exactValue);
    return `/api/table-reference?${params}`;
  }

  async function fetchRows(exactValue?: string): Promise<{ value: string; label: string }[]> {
    try {
      const res = await fetch(buildUrl(exactValue));
      return res.ok ? await res.json() : [];
    } catch {
      return [];
    }
  }

  onMount(async () => {
    const rows = await fetchRows();
    if (selected && !rows.some((r) => r.value === selected)) {
      const resolved = await fetchRows(selected).catch(() => []);
      if (resolved[0]) rows.unshift(resolved[0]);
    }
    options = rows;
  });
</script>

<SingleSelect
  {options}
  bind:selected
  {placeholder}
  class={className}
  {disabled}
  onchange={(next) => onchange?.(next)}
/>
