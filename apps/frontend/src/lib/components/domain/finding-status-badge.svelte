<script lang="ts">
  import StatusBadge from '$lib/components/status-badge.svelte';

  let { status }: { status: string } = $props();

  const variant = $derived.by(() => {
    switch (status) {
      case 'open':
        return 'medium';
      case 'regressed':
        return 'high';
      default:
        return 'default';
    }
  });
</script>

<StatusBadge {variant}>{status.toUpperCase()}</StatusBadge>
