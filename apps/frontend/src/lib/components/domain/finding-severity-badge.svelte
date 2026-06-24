<script lang="ts">
  import StatusBadge from '$lib/components/status-badge.svelte';

  let { severity }: { severity: number } = $props();

  const labels: Record<number, string> = {
    4: 'CRITICAL',
    3: 'High',
    2: 'Medium',
    1: 'Low',
  };

  const variant = $derived.by(() => {
    switch (severity) {
      case 4:
        return 'critical';
      case 3:
        return 'high';
      case 2:
        return 'medium';
      case 1:
        return 'low';
      default:
        return 'default';
    }
  });
</script>

<StatusBadge {variant}>{labels[severity]}</StatusBadge>
