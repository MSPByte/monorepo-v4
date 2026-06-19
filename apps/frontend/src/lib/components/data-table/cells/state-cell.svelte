<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import { formatStringProper } from '$lib/utils/format.js';

  export function stateClass(state: string | null): string {
  switch (state) {
    case 'normal':
      return 'bg-green-500/15 text-green-600 border-green-500/30';
    case 'warn':
      return 'bg-yellow-500/15 text-yellow-600 border-yellow-500/30';
    case 'critical':
      return 'bg-destructive/15 text-destructive border-destructive/30';
    default:
      return 'bg-muted text-muted-foreground';
  }
}


  let { value }: { value: string | null } = $props();
</script>

<Badge variant="outline" class={stateClass(value)}>
  {value ? formatStringProper(value) : '—'}
</Badge>
