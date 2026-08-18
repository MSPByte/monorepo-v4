<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import PackageBuilder, { type PackageDraft, type Step } from '../_package-builder.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const initial: PackageDraft = {
    name: '',
    description: '',
    status: 'draft',
    steps: [],
    prompts: [],
    outcomeSteps: { onSuccess: [], onFailure: [] },
    exposedOutputs: [],
    allowedSites: [],
    allowedSiteGroups: [],
    allowedIntegrationLinks: [],
  };

  // Mirror of [id]/+page.svelte::serializeSteps — strips the UI-only synthetic
  // capabilityId from sub-package steps before the tRPC call.
  function serializeSteps(steps: Step[]): unknown[] {
    return steps.map((s) => {
      if (s.kind === 'subpackage') {
        return {
          kind: 'subpackage',
          packageId: s.packageId,
          label: s.label,
          optional: s.optional,
          inputBindings: s.inputBindings,
        };
      }
      return {
        kind: 'capability',
        capabilityId: s.capabilityId,
        label: s.label,
        optional: s.optional,
        inputBindings: s.inputBindings,
      };
    });
  }

  const create = createMutation(() => ({
    mutationFn: (draft: PackageDraft) =>
      trpc.packages.create.mutate({
        name: draft.name,
        description: draft.description || undefined,
        status: draft.status,
        steps: serializeSteps(draft.steps) as never,
        prompts: draft.prompts,
        outcomeSteps: {
          onSuccess: serializeSteps(draft.outcomeSteps.onSuccess) as never,
          onFailure: serializeSteps(draft.outcomeSteps.onFailure) as never,
        },
        exposedOutputs: draft.exposedOutputs,
        allowedSites: draft.allowedSites,
        allowedSiteGroups: draft.allowedSiteGroups,
        allowedIntegrationLinks: draft.allowedIntegrationLinks,
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
