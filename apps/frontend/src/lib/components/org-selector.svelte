<script lang="ts">
  import * as Command from '$lib/components/ui/command/index.js';
  import { Building2 } from '@lucide/svelte';

  const {
    orgs,
    activeOrgId,
    onselect,
  }: {
    orgs: Array<{ id: string; name: string }>;
    activeOrgId?: string;
    onselect: (id: string) => void;
  } = $props();
</script>

<Command.Root class="rounded-lg border">
  <Command.Input placeholder="Search organizations..." />
  <Command.List>
    <Command.Empty>No organizations found.</Command.Empty>
    <Command.Group>
      {#each orgs as org}
        <Command.Item
          value={org.name}
          onSelect={() => onselect(org.id)}
          data-checked={org.id === activeOrgId ? 'true' : undefined}
        >
          <Building2 class="size-4 shrink-0 text-muted-foreground" />
          <span class="truncate">{org.name}</span>
        </Command.Item>
      {/each}
    </Command.Group>
  </Command.List>
</Command.Root>
