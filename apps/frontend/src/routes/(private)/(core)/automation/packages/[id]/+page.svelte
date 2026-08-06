<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Loader from '$lib/components/transition/loader.svelte';
  import PackageBuilder, { type PackageDraft, type Step } from '../_package-builder.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const packageId = $derived(page.params.id!);

  const query = createQuery(() => ({
    queryKey: ['packages.get', packageId],
    queryFn: () => trpc.packages.get.query({ id: packageId }),
  }));

  const update = createMutation(() => ({
    mutationFn: (draft: PackageDraft) =>
      trpc.packages.update.mutate({
        id: packageId,
        name: draft.name,
        description: draft.description || null,
        status: draft.status,
        steps: draft.steps,
      }),
    onSuccess: () => {
      toast.success('Package saved');
      void queryClient.invalidateQueries({ queryKey: ['packages.list'] });
      void queryClient.invalidateQueries({ queryKey: ['packages.get', packageId] });
    },
    onError: (err) => toast.error(err.message ?? 'Failed to save'),
  }));

  const initial = $derived.by<PackageDraft | null>(() => {
    const pkg = query.data;
    if (!pkg) return null;
    return {
      name: pkg.name,
      description: pkg.description ?? '',
      status: pkg.status as PackageDraft['status'],
      steps: (pkg.steps as Step[]) ?? [],
    };
  });
</script>

{#if query.isLoading || !initial}
  <div class="p-6"><Loader /></div>
{:else if query.error}
  <div class="p-6 text-sm text-rose-500">Failed to load package.</div>
{:else}
  <PackageBuilder
    {initial}
    saving={update.isPending}
    onSave={(draft) => update.mutate(draft)}
  />
{/if}
