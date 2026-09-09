<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Loader from '$lib/components/transition/loader.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import '../workspace.css';
  import PackageBuilder, {
    subpackageCapabilityId,
    type ExposedOutput,
    type PackageDraft,
    type Step,
  } from '../_package-builder.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const packageId = $derived(page.params.id!);

  const query = createQuery(() => ({
    queryKey: ['packages.get', packageId],
    queryFn: () => trpc.packages.get.query({ id: packageId }),
  }));

  // Legacy step rows persisted before the discriminator lack a `kind` field;
  // normalize to `capability` so the builder's typed union resolves cleanly.
  // Sub-package steps get their synthetic capabilityId re-attached for the UI.
  function normalizeSteps(raw: unknown): Step[] {
    if (!Array.isArray(raw)) return [];
    return raw.map((s) => {
      const step = s as Record<string, unknown>;
      if (step.kind === 'subpackage' && typeof step.packageId === 'string') {
        return {
          kind: 'subpackage',
          packageId: step.packageId,
          capabilityId: subpackageCapabilityId(step.packageId),
          label: step.label as string | undefined,
          optional: step.optional as boolean | undefined,
          inputBindings: (step.inputBindings ?? {}) as Step['inputBindings'],
        } as Step;
      }
      return {
        kind: 'capability',
        capabilityId: step.capabilityId as string,
        label: step.label as string | undefined,
        optional: step.optional as boolean | undefined,
        inputBindings: (step.inputBindings ?? {}) as Step['inputBindings'],
      } as Step;
    });
  }

  // Strip the UI-only synthetic capabilityId from sub-package steps before
  // sending to the backend; the Zod discriminator drops unknown fields
  // anyway, but being explicit keeps the payload matching the shape reviewers
  // expect in the request log.
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

  const update = createMutation(() => ({
    mutationFn: (draft: PackageDraft) =>
      trpc.packages.update.mutate({
        id: packageId,
        name: draft.name,
        description: draft.description || null,
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
    const rawOutcome = (pkg.outcomeSteps as { onSuccess?: unknown; onFailure?: unknown } | null) ?? {};
    return {
      name: pkg.name,
      description: pkg.description ?? '',
      status: pkg.status as PackageDraft['status'],
      steps: normalizeSteps(pkg.steps),
      prompts: (pkg.prompts as PackageDraft['prompts']) ?? [],
      outcomeSteps: {
        onSuccess: normalizeSteps(rawOutcome.onSuccess ?? []),
        onFailure: normalizeSteps(rawOutcome.onFailure ?? []),
      },
      exposedOutputs: ((pkg as { exposedOutputs?: unknown }).exposedOutputs as ExposedOutput[] | undefined) ?? [],
      allowedSites: (pkg.allowedSites as string[] | null) ?? [],
      allowedSiteGroups: (pkg.allowedSiteGroups as string[] | null) ?? [],
      allowedIntegrationLinks: (pkg.allowedIntegrationLinks as string[] | null) ?? [],
    };
  });
</script>

{#if query.error}
  <div class="pk-route-error"><h1>We couldn’t load this package</h1><p>It may be unavailable, or you may not have access. Try again or return to your library.</p><div><Button variant="outline" href="/automation/packages">Back to packages</Button><Button onclick={() => query.refetch()}>Try again</Button></div></div>
{:else if query.isLoading}
  <Loader />
{:else if !initial}
  <div class="pk-route-error"><h1>Package unavailable</h1><Button href="/automation/packages">Back to packages</Button></div>
{:else}
  {#key packageId}
  <PackageBuilder
    {initial}
    currentPackageId={packageId}
    saving={update.isPending}
    onSave={(draft) => update.mutate(draft)}
  />
  {/key}
{/if}
