<script lang="ts">
  import StatusBadge from '$lib/components/status-badge.svelte';

  let { value }: { value: string } = $props();

  function variant(status: string) {
    switch (status) {
      case 'Active':
        return 'default' as const;
      case 'Not Setup':
        return 'low' as const;
      case 'Pending Delete':
        return 'medium' as const;
      default:
        return 'default' as const;
    }
  }
</script>

<StatusBadge variant={variant(value)}>{value}</StatusBadge>
