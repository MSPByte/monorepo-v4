<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Filter, Check } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import { showErrorToast } from '$lib/utils/errors';

  type ScopeKind = 'all' | 'sites' | 'groups' | 'links';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();

  const prefsQuery = createQuery(() => ({
    queryKey: ['reports.getMyPrefs'],
    queryFn: () => trpc.reports.getMyPrefs.query(),
    staleTime: 60_000,
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
    staleTime: 5 * 60_000,
  }));

  const groupsQuery = createQuery(() => ({
    queryKey: ['siteGroups.list'],
    queryFn: () => trpc.siteGroups.list.query(),
    staleTime: 5 * 60_000,
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', 'microsoft-365', 'active'],
    queryFn: () =>
      trpc.integrationLinks.list.query({
        integrationId: 'microsoft-365',
        status: 'active',
      }),
    staleTime: 5 * 60_000,
  }));

  // -- popover state ---------------------------------------------------------

  let open = $state(false);
  let draftKind = $state<ScopeKind>('all');
  let draftIds = $state<string[]>([]);
  let saving = $state(false);
  let hydrated = false;

  $effect(() => {
    if (prefsQuery.data && !hydrated) {
      draftKind = (prefsQuery.data.scopeKind as ScopeKind) ?? 'all';
      draftIds = [...(prefsQuery.data.scopeIds ?? [])];
      hydrated = true;
    }
  });

  // -- derived ---------------------------------------------------------------

  const currentKind = $derived<ScopeKind>((prefsQuery.data?.scopeKind as ScopeKind) ?? 'all');
  const currentIds = $derived<string[]>(prefsQuery.data?.scopeIds ?? []);

  const siteOptions = $derived(
    (sitesQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))
  );
  const groupOptions = $derived(
    (groupsQuery.data ?? []).map((g) => ({ value: g.id, label: g.name }))
  );
  const linkOptions = $derived(
    (linksQuery.data ?? []).map((l) => ({
      value: l.id,
      label: l.name || l.externalId || l.id,
    }))
  );

  const draftOptions = $derived(
    draftKind === 'sites'
      ? siteOptions
      : draftKind === 'groups'
        ? groupOptions
        : draftKind === 'links'
          ? linkOptions
          : []
  );

  const chipLabel = $derived.by(() => {
    if (currentKind === 'all') return 'All sites';
    if (currentIds.length === 0) return `No ${currentKind}`;
    const source =
      currentKind === 'sites' ? siteOptions : currentKind === 'groups' ? groupOptions : linkOptions;
    if (currentIds.length === 1) {
      const match = source.find((o) => o.value === currentIds[0]);
      return match?.label ?? `1 ${trimS(currentKind)}`;
    }
    return `${currentIds.length} ${currentKind}`;
  });

  function trimS(s: string) {
    return s.endsWith('s') ? s.slice(0, -1) : s;
  }

  const dirty = $derived(
    draftKind !== currentKind ||
      JSON.stringify([...draftIds].sort()) !== JSON.stringify([...currentIds].sort())
  );

  // -- actions ---------------------------------------------------------------

  function pickKind(kind: ScopeKind) {
    draftKind = kind;
    if (kind === 'all') draftIds = [];
  }

  async function apply() {
    saving = true;
    try {
      await trpc.reports.saveMyPrefs.mutate({
        scopeKind: draftKind,
        scopeIds: draftKind === 'all' ? [] : draftIds,
      });
      await queryClient.invalidateQueries({ queryKey: ['reports.getMyPrefs'] });
      // Composer previews depend on scope; nudge the report cache.
      await queryClient.invalidateQueries({ queryKey: ['reports.run'] });
      window.dispatchEvent(new CustomEvent('reports:scope-changed'));
      toast.success('Scope updated');
      open = false;
    } catch (err) {
      showErrorToast(err, 'Failed to update scope');
    } finally {
      saving = false;
    }
  }

  function cancel() {
    draftKind = currentKind;
    draftIds = [...currentIds];
    open = false;
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <button
        {...props}
        class="border-input bg-background hover:bg-accent inline-flex h-8 items-center gap-2 rounded-md border px-2.5 text-xs font-medium transition-colors"
      >
        <Filter class="size-3.5" />
        <span class="text-muted-foreground">Scope:</span>
        <span class="text-foreground">{chipLabel}</span>
      </button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content align="end" class="w-80 p-3">
    <div class="space-y-3">
      <div>
        <div class="text-xs font-medium">Filter reports by</div>
        <p class="text-muted-foreground mt-0.5 text-[11px]">
          Applies to every report and dashboard. Sticks across sessions.
        </p>
      </div>

      <div class="grid grid-cols-4 gap-1">
        {#each ['all', 'sites', 'groups', 'links'] as kind}
          <button
            type="button"
            onclick={() => pickKind(kind as ScopeKind)}
            class="hover:bg-accent inline-flex items-center justify-center gap-1 rounded-md border px-2 py-1.5 text-[11px] font-medium capitalize transition-colors {draftKind ===
            kind
              ? 'border-primary bg-primary/5 text-foreground'
              : 'border-input text-muted-foreground'}"
          >
            {#if draftKind === kind}
              <Check class="size-3" />
            {/if}
            {kind}
          </button>
        {/each}
      </div>

      {#if draftKind !== 'all'}
        <div>
          <MultiSelect
            options={draftOptions}
            bind:selected={draftIds}
            placeholder={`Choose ${draftKind}…`}
            searchPlaceholder={`Search ${draftKind}…`}
          />
        </div>
      {/if}

      <div class="flex items-center justify-end gap-2 border-t pt-2">
        <Button variant="ghost" size="sm" onclick={cancel}>Cancel</Button>
        <Button size="sm" disabled={!dirty || saving} onclick={apply}>Apply</Button>
      </div>
    </div>
  </Popover.Content>
</Popover.Root>
