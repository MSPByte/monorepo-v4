<script lang="ts">
  import { onMount } from 'svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import type { FieldReference } from '@mspbyte/shared';

  let {
    ref,
    selected = $bindable([]),
    onchange,
    placeholder = 'Select values...',
    class: className = '',
    disabled,
    limit = 200,
  }: {
    ref: FieldReference;
    selected?: string[];
    onchange?: (v: string[]) => void;
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

  function merge(
    special: { value: string; label: string }[],
    rows: { value: string; label: string }[],
    priority: { value: string; label: string }[]
  ): { value: string; label: string }[] {
    const seen = new Set<string>();
    const result: { value: string; label: string }[] = [];
    for (const item of [...special, ...priority, ...rows]) {
      if (!seen.has(item.value)) {
        seen.add(item.value);
        result.push(item);
      }
    }
    return result;
  }

  onMount(async () => {
    const rows = await fetchRows();
    // Guarantee any pre-selected values render with a label even if outside the initial page.
    const missing = selected.filter((v) => !rows.some((r) => r.value === v));
    const resolved = await Promise.all(missing.map((v) => fetchRows(v).then((r) => r[0]).catch(() => undefined)));
    const priority = resolved.filter((r): r is { value: string; label: string } => Boolean(r));
    options = merge(ref.specialValues ?? [], rows, priority);
  });
</script>

<MultiSelect
  {options}
  bind:selected
  {placeholder}
  class={className}
  {disabled}
  onchange={(next) => onchange?.(next)}
/>
