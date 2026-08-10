<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import PackageBuilder, { type PackageDraft } from '../_package-builder.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const initial: PackageDraft = {
    name: '',
    description: '',
    status: 'draft',
    steps: [],
    allowedSites: [],
    allowedSiteGroups: [],
  };

  const create = createMutation(() => ({
    mutationFn: (draft: PackageDraft) =>
      trpc.packages.create.mutate({
        name: draft.name,
        description: draft.description || undefined,
        status: draft.status,
        steps: draft.steps,
        allowedSites: draft.allowedSites,
        allowedSiteGroups: draft.allowedSiteGroups,
      }),
    onSuccess: (result) => {
      toast.success('Package created');
      void queryClient.invalidateQueries({ queryKey: ['packages.list'] });
      void goto(`/automation/packages/${result.id}`);
    },
    onError: (err) => toast.error(err.message ?? 'Failed to create'),
  }));
</script>

<PackageBuilder
  {initial}
  saving={create.isPending}
  onSave={(draft) => create.mutate(draft)}
/>
