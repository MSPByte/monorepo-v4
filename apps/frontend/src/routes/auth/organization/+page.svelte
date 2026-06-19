<script lang="ts">
  import OrgSelector from '$lib/components/org-selector.svelte';
  import { authClient } from '$lib/auth-client';
  import type { PageProps } from './$types';

  const { data }: PageProps = $props();

  let selecting = $state(false);

  async function handleSelect(orgId: string) {
    if (selecting) return;
    selecting = true;
    await authClient.organization.setActive({ organizationId: orgId });
    window.location.href = '/home';
  }
</script>

<div class="flex size-full justify-center items-center">
  <div class="flex flex-col gap-3 w-full max-w-sm">
    <div class="flex flex-col gap-1 px-1">
      <h1 class="text-lg font-semibold">Select Organization</h1>
      <p class="text-sm text-muted-foreground">Choose which organization to work in.</p>
    </div>
    <OrgSelector orgs={data.organizations} onselect={handleSelect} />
    {#if selecting}
      <p class="text-sm text-muted-foreground text-center">Switching...</p>
    {/if}
  </div>
</div>
