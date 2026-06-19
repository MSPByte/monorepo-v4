<script lang="ts">
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Button } from '$lib/components/ui/button/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { toast } from 'svelte-sonner';
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import type { ComplianceFramework as Framework } from '@mspbyte/drizzle';

  let {
    open = $bindable(false),
    mode,
    framework = null,
    onsuccess,
  }: {
    open: boolean;
    mode: 'create' | 'edit';
    framework?: Framework | null;
    onsuccess?: () => void;
  } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const frameworksQuery = createQuery(() => ({
    queryKey: ['compliance.listFrameworks', 'microsoft-365'],
    queryFn: () => trpc.compliance.listFrameworks.query({ integrationId: 'microsoft-365' }),
    enabled: open,
  }));

  const createMut = createMutation(() => ({
    mutationFn: (input: { name: string; description?: string; integrationId: string; parentId?: string }) =>
      trpc.compliance.createFramework.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listFrameworks'] });
    },
  }));

  const updateMut = createMutation(() => ({
    mutationFn: (input: { id: string; name?: string; description?: string | null; parentId?: string | null }) =>
      trpc.compliance.updateFramework.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['compliance.listFrameworks'] });
    },
  }));

  let name = $state('');
  let description = $state('');
  let parent = $state<string | undefined>(undefined);
  let loading = $state(false);

  const filteredFrameworks = $derived(
    (frameworksQuery.data ?? []).filter((f) => f.id !== framework?.id),
  );

  $effect(() => {
    if (open) {
      if (mode === 'edit' && framework) {
        name = framework.name;
        description = framework.description ?? '';
        parent = framework.parentId ?? undefined;
      } else {
        name = '';
        description = '';
        parent = undefined;
      }
    }
  });

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error('Name is required');
      return;
    }
    loading = true;
    try {
      if (mode === 'create') {
        await createMut.mutateAsync({
          integrationId: 'microsoft-365',
          name: name.trim(),
          description: description.trim() || undefined,
          parentId: parent,
        });
        toast.info('Framework created');
      } else if (framework) {
        await updateMut.mutateAsync({
          id: framework.id,
          name: name.trim(),
          description: description.trim() || null,
          parentId: parent ?? null,
        });
        toast.info('Framework updated');
      }
      open = false;
      onsuccess?.();
    } catch (err) {
      toast.error(`Failed to save framework: ${String(err)}`);
    } finally {
      loading = false;
    }
  }
</script>

<Sheet.Root bind:open>
  <Sheet.Portal>
    <Sheet.Overlay />
    <Sheet.Content side="right" class="w-96 flex flex-col gap-0 p-0">
      <Sheet.Header class="p-4 border-b">
        <Sheet.Title>{mode === 'create' ? 'New Framework' : 'Edit Framework'}</Sheet.Title>
        <Sheet.Description>
          {mode === 'create' ? 'Define a new compliance framework.' : 'Update framework details.'}
        </Sheet.Description>
      </Sheet.Header>

      <div class="flex flex-col p-4 gap-4 flex-1 overflow-y-auto">
        <div class="flex flex-col gap-1.5">
          <Label for="fw-name">Name</Label>
          <Input
            id="fw-name"
            bind:value={name}
            disabled={!authStore.isAllowed('Integrations.Write')}
            placeholder="e.g. CIS M365 Baseline"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label for="fw-desc">Description</Label>
          <Textarea
            id="fw-desc"
            bind:value={description}
            disabled={!authStore.isAllowed('Integrations.Write')}
            placeholder="Optional description..."
            rows={4}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <Label>Parent Framework</Label>
          <SingleSelect
            placeholder="Select Framework..."
            bind:selected={parent}
            options={filteredFrameworks.map((f) => ({ label: f.name, value: f.id }))}
            disabled={!authStore.isAllowed('Integrations.Write')}
          />
        </div>
      </div>

      <Sheet.Footer class="p-4 border-t">
        <Button variant="outline" onclick={() => (open = false)}>Cancel</Button>
        <Button
          onclick={handleSubmit}
          disabled={loading || !authStore.isAllowed('Integrations.Write')}
        >
          {loading ? 'Saving...' : 'Save'}
        </Button>
      </Sheet.Footer>
    </Sheet.Content>
  </Sheet.Portal>
</Sheet.Root>
