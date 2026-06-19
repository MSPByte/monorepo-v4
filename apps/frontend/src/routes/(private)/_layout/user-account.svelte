<script lang="ts">
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { authClient } from '$lib/auth-client';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import OrgSelector from '$lib/components/org-selector.svelte';
  import { Power, Sun, Moon, ArrowLeftRight, Building2 } from '@lucide/svelte';
  import { toggleMode, mode } from 'mode-watcher';

  const { orgId, orgName }: { orgId: string; orgName: string } = $props();

  let orgDialogOpen = $state(false);
  let orgs = $state<Array<{ id: string; name: string }>>([]);
  let loadingOrgs = $state(false);
  let switching = $state(false);

  $effect(() => {
    if (orgDialogOpen) {
      loadingOrgs = true;
      authClient.organization
        .list()
        .then((result) => {
          orgs = (result.data as Array<{ id: string; name: string }>) ?? [];
        })
        .finally(() => {
          loadingOrgs = false;
        });
    }
  });

  async function handleSwitchOrg(newOrgId: string) {
    if (switching || newOrgId === orgId) return;
    switching = true;
    await authClient.organization.setActive({ organizationId: newOrgId });
    window.location.href = '/home';
  }

  function handleLogout() {
    authStore.logout(() => {
      void authClient.signOut({
        fetchOptions: {
          onSuccess: () => {
            window.location.href = '/';
          },
        },
      });
    });
  }

  const initials = $derived(
    authStore.currentUser
      ? authStore.currentUser.name
          .split(' ')
          .map((n: string) => n[0])
          .join('')
          .slice(0, 2)
          .toUpperCase()
      : 'AA'
  );
</script>

<DropdownMenu.Root>
  <DropdownMenu.Trigger>
    <div
      class="flex rounded-full bg-primary items-center justify-center size-10 text-base text-primary-foreground"
    >
      {initials}
    </div>
  </DropdownMenu.Trigger>
  <DropdownMenu.Content>
    <DropdownMenu.Group>
      <DropdownMenu.Label>
        {authStore.currentUser?.name}
      </DropdownMenu.Label>
      <DropdownMenu.Separator />
      <DropdownMenu.Item class="flex justify-between" onclick={toggleMode} closeOnSelect={false}>
        <div class="flex items-center gap-2">
          {#if mode.current === 'dark'}
            <Moon class="h-4 w-4" />
            Dark Mode
          {:else}
            <Sun class="h-4 w-4" />
            Light Mode
          {/if}
        </div>
      </DropdownMenu.Item>
      <DropdownMenu.Item class="flex gap-2" onclick={() => (orgDialogOpen = true)}>
        <ArrowLeftRight class="h-4 w-4" /> Switch Org
      </DropdownMenu.Item>
      <DropdownMenu.Item
        onclick={handleLogout}
        class="flex gap-2 text-destructive hover:text-destructive"
      >
        <Power class="h-4 w-4" /> Logout
      </DropdownMenu.Item>
      <DropdownMenu.Separator />
      <DropdownMenu.Label>
        {orgName}
      </DropdownMenu.Label>
    </DropdownMenu.Group>
  </DropdownMenu.Content>
</DropdownMenu.Root>

<Dialog.Root bind:open={orgDialogOpen}>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Switch Organization</Dialog.Title>
      <Dialog.Description>Select an organization to switch to.</Dialog.Description>
    </Dialog.Header>
    {#if loadingOrgs}
      <div class="flex items-center justify-center py-8">
        <p class="text-sm text-muted-foreground">Loading organizations...</p>
      </div>
    {:else}
      <OrgSelector {orgs} activeOrgId={orgId} onselect={handleSwitchOrg} />
      {#if switching}
        <p class="text-sm text-muted-foreground text-center">Switching...</p>
      {/if}
    {/if}
  </Dialog.Content>
</Dialog.Root>
