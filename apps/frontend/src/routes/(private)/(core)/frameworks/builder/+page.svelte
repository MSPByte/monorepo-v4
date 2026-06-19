<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { Save } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Card from '$lib/components/ui/card/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Switch } from '$lib/components/ui/switch/index.js';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  let name = $state('');
  let description = $state('');
  let category = $state('Baseline');
  let enabled = $state(true);
  let saving = $state(false);

  async function saveFramework() {
    if (!name.trim()) {
      toast.error('Framework name is required');
      return;
    }
    saving = true;
    try {
      const created = await trpc.frameworks.create.mutate({
        name,
        description: description || null,
        category: category || null,
        enabled
      });
      toast.success('Framework created');
      await goto(`/frameworks/${created.id}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create framework');
    } finally {
      saving = false;
    }
  }
</script>

<div class="size-full overflow-auto p-6">
  <Card.Root class="mx-auto max-w-3xl">
    <Card.Header>
      <Card.Title>New Framework</Card.Title>
      <Card.Description>Create a policy set. Add policies and mappings from the framework detail page.</Card.Description>
    </Card.Header>
    <Card.Content class="grid gap-4">
      <label class="grid gap-1 text-sm font-medium">Name<Input bind:value={name} placeholder="Internal MSP Baseline" /></label>
      <label class="grid gap-1 text-sm font-medium">Category<Input bind:value={category} /></label>
      <label class="grid gap-1 text-sm font-medium">Description<Textarea bind:value={description} /></label>
      <label class="flex items-center gap-3 rounded-md border px-3 py-2 text-sm font-medium">
        <Switch bind:checked={enabled} />
        Enabled
      </label>
    </Card.Content>
    <Card.Footer class="gap-2">
      <Button variant="outline" onclick={() => goto('/frameworks')}>Cancel</Button>
      <Button onclick={saveFramework} disabled={saving} class="gap-2">
        <Save class="size-4" />
        Create Framework
      </Button>
    </Card.Footer>
  </Card.Root>
</div>
