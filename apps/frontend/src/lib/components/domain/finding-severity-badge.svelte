<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';

  let { severity }: { severity: number } = $props();

  const labels: Record<number, string> = {
    4: 'Critical',
    3: 'High',
    2: 'Medium',
    1: 'Low',
  };
</script>

<Badge
  variant={severity >= 3 ? 'destructive' : severity === 2 ? 'secondary' : 'outline'}
  class={severity === 4 ? 'bg-red-700 text-white dark:bg-red-600' : ''}
>
  {labels[severity] ?? 'Info'}
</Badge>
