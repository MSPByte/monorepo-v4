<script lang="ts">
  import StatusBadge from '$lib/components/status-badge.svelte';

  type Props = {
    prefix: string;
    id: string;
    title?: string;
  };
  let { prefix, id, title }: Props = $props();

  // Stable short code derived from an entity ID so people can refer to it
  // in chat. Strips dashes and uppercases the first 4 hex chars.
  const code = $derived(id.replace(/-/g, '').slice(0, 4).toUpperCase());
</script>

<StatusBadge variant="low" title={title ?? `${prefix} callsign — first 4 chars of ID`}>
  {prefix}·{code}
</StatusBadge>
