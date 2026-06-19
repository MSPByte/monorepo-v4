<script lang="ts">
  import { formatDate } from '$lib/utils/format.js';

  let { value, withTime }: { value: string | number | null; withTime?: boolean } = $props();

  const formatted = $derived.by(() => {
    if (!value) return '—';
    const date = new Date(value);

    if (!withTime) {
      return formatDate(date.toISOString());
    } else {
      return formatDate(date.toISOString()) + ' ' + date.toLocaleTimeString();
    }
  });
</script>

{formatted}
