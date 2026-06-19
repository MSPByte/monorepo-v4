<script lang="ts">
  import * as Card from '$lib/components/ui/card';

  let {
    label,
    value,
    detail,
  }: {
    label: string;
    value: string | number;
    detail?: string;
  } = $props();
</script>

<Card.Root class="rounded-lg">
  <Card.Header class="pb-2">
    <Card.Description>{label}</Card.Description>
    <Card.Title class="text-2xl">{value}</Card.Title>
  </Card.Header>
  {#if detail}
    <Card.Content class="text-xs text-muted-foreground">{detail}</Card.Content>
  {/if}
</Card.Root>
