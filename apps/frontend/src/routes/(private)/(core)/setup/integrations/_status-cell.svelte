<script lang="ts">
  import StatusBadge from '$lib/components/status-badge.svelte';

  let { value }: { value: string } = $props();

  function variant(status: string) {
    switch (status) {
      case 'Active': return 'success' as const;
      case 'Not Setup': return 'muted' as const;
      case 'Pending Delete': return 'warning' as const;
      default: return 'default' as const;
    }
  }
</script>

<StatusBadge variant={variant(value)}>{value}</StatusBadge>
