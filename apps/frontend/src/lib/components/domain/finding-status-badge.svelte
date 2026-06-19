<script lang="ts">
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import { formatStringProper } from '$lib/utils/format';

  let { status }: { status: string } = $props();
</script>

<Badge variant={status === 'open' || status === 'regressed' ? 'default' : 'outline'}>
  {formatStringProper(status)}
</Badge>
