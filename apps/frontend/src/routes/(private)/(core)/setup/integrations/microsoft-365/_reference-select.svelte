<script lang="ts">
  import { onMount } from 'svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import type { FieldReference } from '@mspbyte/shared';

  let {
    ref,
    selected,
    onchange,
    class: className = '',
    disabled,
  }: {
    ref: FieldReference;
    selected: string;
    onchange: (v: string) => void;
    class?: string;
    disabled?: boolean;
  } = $props();

  let options = $state<{ value: string; label: string }[]>([]);
  let loading = $state(false);
  let debounceTimer: ReturnType<typeof setTimeout> | undefined;

  function buildUrl(query?: string, exactValue?: string): string {
    const params = new URLSearchParams({
      table: ref.table,
      valueColumn: ref.valueColumn,
      labelColumn: ref.labelColumn,
    });
    if (exactValue !== undefined) params.set('exactValue', exactValue);
    else if (query?.trim()) params.set('query', query.trim());
    return `/api/table-reference?${params}`;
  }

  async function fetchRows(
    query?: string,
    exactValue?: string
  ): Promise<{ value: string; label: string }[]> {
    try {
      const res = await fetch(buildUrl(query, exactValue));
      return res.ok ? await res.json() : [];
    } catch {
      return [];
    }
  }

  function mergeOptions(
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
    loading = true;
    const [initialRows, selectedRows] = await Promise.all([
      fetchRows(),
      selected ? fetchRows(undefined, selected) : Promise.resolve([]),
    ]);
    options = mergeOptions(ref.specialValues ?? [], initialRows, selectedRows);
    loading = false;
  });

  function handleSearch(query: string) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      loading = true;
      const rows = await fetchRows(query);
      const currentItem = options.find((o) => o.value === selected);
      options = mergeOptions(ref.specialValues ?? [], rows, currentItem ? [currentItem] : []);
      loading = false;
    }, 300);
  }
</script>

<SingleSelect
  {options}
  {selected}
  {loading}
  onsearch={handleSearch}
  {onchange}
  placeholder="Select..."
  class={className}
  {disabled}
/>
