<script lang="ts">
  import { getContext } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';
  import { INTEGRATIONS, getPolicyTableShape, type ProviderId } from '@mspbyte/shared';

  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import { serializeFilters } from '$lib/components/data-table';
  import { prettyText } from '$lib/utils/format';
  import { authStore } from '$lib/stores/auth.store.svelte';

  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import CircleCheck from '@lucide/svelte/icons/circle-check';
  import CircleAlert from '@lucide/svelte/icons/circle-alert';
  import EllipsisVertical from '@lucide/svelte/icons/ellipsis-vertical';
  import Link2 from '@lucide/svelte/icons/link-2';
  import Link2Off from '@lucide/svelte/icons/link-2-off';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Loader2 from '@lucide/svelte/icons/loader-2';

  export type SourceRecord = {
    id?: string;
    label?: string;
    table?: string;
    provider?: string;
    type?: string;
    externalId?: string;
    vendorRecordId?: string;
    linkId?: string | null;
    linkName?: string | null;
    linkStatus?: string | null;
    integrationId?: string | null;
    siteId?: string | null;
    confidence?: number;
    matchMethod?: string;
    status?: string;
    manuallyConfirmedAt?: string | null;
    manuallyRejectedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
  };

  let {
    canonicalType,
    canonicalId,
    canonicalLabel,
    sources,
    queryKey,
    code = '01',
    title = 'VENDOR SOURCE RECORDS',
  }: {
    canonicalType: 'asset';
    canonicalId: string;
    canonicalLabel?: string;
    sources: SourceRecord[];
    queryKey: readonly unknown[];
    code?: string;
    title?: string;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const canWrite = $derived(authStore.isAllowed('Assets.Write'));
  const canDelete = $derived(authStore.isAllowed('Assets.Delete'));

  const confirmedCount = $derived(
    sources.filter((s) => (s.status ?? 'confirmed') === 'confirmed').length
  );
  const candidateCount = $derived(sources.filter((s) => s.status === 'candidate').length);

  let addOpen = $state(false);
  let searchInput = $state('');
  let searchDebounced = $state('');
  let debounceHandle: ReturnType<typeof setTimeout> | null = null;

  function scheduleSearch(value: string) {
    if (debounceHandle) clearTimeout(debounceHandle);
    debounceHandle = setTimeout(() => {
      searchDebounced = value.trim();
    }, 200);
  }

  $effect(() => {
    scheduleSearch(searchInput);
    return () => {
      if (debounceHandle) clearTimeout(debounceHandle);
    };
  });

  $effect(() => {
    if (addOpen) {
      searchInput = '';
      searchDebounced = '';
    }
  });

  const candidatesQuery = createQuery(() => ({
    queryKey: ['entitySources.candidateVendorRecords', canonicalType, canonicalId, searchDebounced],
    queryFn: () =>
      trpc.entitySources.candidateVendorRecords.query({
        canonicalType,
        canonicalId,
        search: searchDebounced || undefined,
        limit: 25,
      }),
    enabled: addOpen,
    staleTime: 15_000,
  }));

  type Candidate = NonNullable<typeof candidatesQuery.data>[number];

  let unlinkTarget = $state<SourceRecord | null>(null);

  function invalidate() {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({
      queryKey: ['entitySources.candidateVendorRecords', canonicalType, canonicalId],
    });
  }

  const linkMut = createMutation(() => ({
    mutationFn: (payload: { vendorTable: string; vendorRecordId: string }) =>
      trpc.entitySources.link.mutate({
        canonicalType,
        canonicalId,
        vendorTable: payload.vendorTable,
        vendorRecordId: payload.vendorRecordId,
      }),
    onSuccess: () => {
      toast.success('Source linked');
      addOpen = false;
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Link failed'),
  }));

  const unlinkMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.entitySources.unlink.mutate({ id }),
    onSuccess: () => {
      toast.success('Source unlinked');
      unlinkTarget = null;
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Unlink failed'),
  }));

  const confirmMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.entitySources.confirm.mutate({ id }),
    onSuccess: () => {
      toast.success('Match confirmed');
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Confirm failed'),
  }));

  const rejectMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.entitySources.reject.mutate({ id }),
    onSuccess: () => {
      toast.success('Match rejected');
      invalidate();
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Reject failed'),
  }));

  function providerName(id?: string | null): string {
    if (!id) return 'Integration';
    return INTEGRATIONS[id as ProviderId]?.name ?? id;
  }

  function statusDot(source: SourceRecord): string {
    const status = source.status ?? 'confirmed';
    if (status === 'candidate') return 'bg-warning';
    if (source.linkStatus === 'error') return 'bg-destructive';
    if (source.linkStatus === 'active' || status === 'confirmed') return 'bg-primary';
    return 'bg-muted-foreground';
  }

  function sourceIntegrationHref(source: SourceRecord): string | null {
    if (!source.integrationId) return null;
    const params = new URLSearchParams();
    if (source.linkId) params.set('linkId', source.linkId);
    if (source.siteId) params.set('siteId', source.siteId);
    const qs = params.toString();
    return qs ? `/${source.integrationId}?${qs}` : `/${source.integrationId}`;
  }

  function sourceHref(source: SourceRecord): string | null {
    if (!source.table || !source.externalId) return null;
    const route = getPolicyTableShape(source.table)?.route;
    if (!route) return null;
    const filters = serializeFilters([
      {
        id: 'canonical-source',
        field: route.searchField,
        operator: 'eq',
        value: source.externalId,
      },
    ]);

    const params = new URLSearchParams({ filters });
    if (source.linkId) params.set('linkId', source.linkId);

    return `${route.path}?${params.toString()}`;
  }

  function candidateProviderLabel(candidate: Candidate): string {
    const name = providerName(candidate.integrationId);
    const table = getPolicyTableShape(candidate.vendorTable)?.label ?? candidate.vendorTable;
    return `${name} · ${table}`;
  }

  function candidateStatusLabel(candidate: Candidate): string | null {
    if (!candidate.currentSourceId) return null;
    if (candidate.currentCanonicalId === canonicalId) {
      return candidate.currentStatus === 'candidate' ? 'candidate here' : 'linked here';
    }
    if (candidate.currentStatus === 'confirmed') return 'linked elsewhere';
    if (candidate.currentStatus === 'candidate') return 'candidate elsewhere';
    return candidate.currentStatus ?? null;
  }
</script>

{#snippet sourceRow(source: SourceRecord)}
  {@const href = sourceHref(source)}
  {@const status = source.status ?? 'confirmed'}
  {@const isCandidate = status === 'candidate'}
  <div
    class={[
      'group grid gap-3 border-b border-border/40 py-2 text-sm last:border-b-0 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center',
      isCandidate ? 'bg-warning/5' : '',
    ].join(' ')}
  >
    <div class="flex min-w-0 items-baseline gap-2">
      <span class={`size-1.5 shrink-0 translate-y-px rounded-full ${statusDot(source)}`}></span>
      <div class="min-w-0">
        <div class="flex items-center gap-1.5 truncate">
          {#if href}
            <a {href} target="_blank" class="truncate hover:underline">
              {source.label ?? prettyText(source.table ?? 'Source')}
            </a>
          {:else}
            <span class="truncate">{source.label ?? prettyText(source.table ?? 'Source')}</span>
          {/if}
          {#if isCandidate}
            <span
              class="inline-flex items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-1 font-mono text-[9px] uppercase tracking-wider text-warning"
            >
              <CircleAlert class="size-2.5" /> needs review
            </span>
          {:else if source.matchMethod === 'manual'}
            <span
              class="inline-flex items-center gap-1 rounded-sm border border-border/70 bg-muted/50 px-1 font-mono text-[9px] uppercase tracking-wider text-muted-foreground"
            >
              manual
            </span>
          {/if}
        </div>
        <div
          class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
        >
          {source.provider ?? 'provider'}{source.confidence !== undefined
            ? ` · ${source.confidence}% conf`
            : ''}
        </div>
      </div>
    </div>
    <div class="min-w-0 font-mono text-[11.5px] text-muted-foreground">
      {#if source.linkId}
        <a href={sourceIntegrationHref(source) ?? '#'} class="truncate hover:underline">
          {source.linkName ?? source.linkId}
        </a>
      {:else}
        <span>no link</span>
      {/if}
    </div>
    <div class="flex shrink-0 items-center gap-1">
      {#if href}
        <a
          {href}
          target="_blank"
          class="inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:text-foreground"
        >
          open <ArrowUpRight class="size-3" />
        </a>
      {/if}
      {#if source.id && (canWrite || canDelete)}
        <DropdownMenu.Root>
          <DropdownMenu.Trigger>
            {#snippet child({ props })}
              <button
                class="rounded-sm border border-transparent p-1 text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground"
                title="Source options"
                aria-label="Source options"
                {...props}
              >
                <EllipsisVertical class="size-3.5" />
              </button>
            {/snippet}
          </DropdownMenu.Trigger>
          <DropdownMenu.Content class="w-44" align="end">
            {#if isCandidate && canWrite}
              <DropdownMenu.Item
                class="gap-2 cursor-pointer"
                onclick={() => source.id && confirmMut.mutate(source.id)}
              >
                <CircleCheck class="size-3.5" /> Confirm match
              </DropdownMenu.Item>
              <DropdownMenu.Item
                class="gap-2 cursor-pointer text-destructive focus:text-destructive"
                onclick={() => source.id && rejectMut.mutate(source.id)}
              >
                <CircleAlert class="size-3.5" /> Reject match
              </DropdownMenu.Item>
              <DropdownMenu.Separator />
            {/if}
            {#if canDelete}
              <DropdownMenu.Item
                class="gap-2 cursor-pointer text-destructive focus:text-destructive"
                onclick={() => (unlinkTarget = source)}
              >
                <Link2Off class="size-3.5" /> Unlink
              </DropdownMenu.Item>
            {/if}
          </DropdownMenu.Content>
        </DropdownMenu.Root>
      {/if}
    </div>
  </div>
{/snippet}

<SectionPanel {code} {title}>
  {#snippet aside()}
    <div class="flex items-center gap-3">
      <span>
        {confirmedCount} confirmed{candidateCount > 0 ? ` · ${candidateCount} pending` : ''}
      </span>
      {#if canWrite}
        <button
          class="inline-flex items-center gap-1 rounded-sm border border-border/60 bg-background px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground"
          onclick={() => (addOpen = true)}
          title="Add manual mapping"
        >
          <Plus class="size-3" /> map
        </button>
      {/if}
    </div>
  {/snippet}
  <div>
    {#each sources as source (source.id ?? `${source.table}-${source.vendorRecordId}`)}
      {@render sourceRow(source)}
    {:else}
      <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
        no vendor records{canWrite ? ' · use MAP to add one' : ''}
      </p>
    {/each}
  </div>
</SectionPanel>

<Dialog.Root bind:open={addOpen}>
  <Dialog.Content class="sm:max-w-[560px]">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">
        <Link2 class="size-4" /> Map a vendor record
      </Dialog.Title>
      <Dialog.Description>
        Search for a vendor record and link it to
        {canonicalLabel ? ` ${canonicalLabel}` : ` this ${canonicalType}`}. Existing bindings will
        be replaced.
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>

    <div class="grid gap-3">
      <div class="relative">
        <Search
          class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          class="pl-8"
          placeholder="Search vendor devices by hostname or external id"
          bind:value={searchInput}
          autofocus
        />
      </div>

      <div class="max-h-80 min-h-[8rem] overflow-auto rounded-sm border border-border/60">
        {#if candidatesQuery.isFetching}
          <div class="flex items-center justify-center gap-2 py-8 text-xs text-muted-foreground">
            <Loader2 class="size-3.5 animate-spin" /> searching
          </div>
        {:else if candidatesQuery.data && candidatesQuery.data.length > 0}
          {@const results = candidatesQuery.data}
          <ul class="divide-y divide-border/40">
            {#each results as candidate (`${candidate.vendorTable}:${candidate.vendorRecordId}`)}
              {@const disabled =
                linkMut.isPending ||
                (candidate.currentCanonicalId === canonicalId &&
                  candidate.currentStatus === 'confirmed')}
              {@const statusLabel = candidateStatusLabel(candidate)}
              <li>
                <button
                  type="button"
                  class="flex w-full items-start justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40 disabled:cursor-not-allowed disabled:opacity-50"
                  {disabled}
                  onclick={() =>
                    linkMut.mutate({
                      vendorTable: candidate.vendorTable,
                      vendorRecordId: candidate.vendorRecordId,
                    })}
                >
                  <div class="min-w-0">
                    <div class="flex items-center gap-1.5">
                      <span class="truncate text-sm">
                        {candidate.label || candidate.externalId}
                      </span>
                      {#if statusLabel}
                        <span
                          class={[
                            'inline-flex items-center rounded-sm border px-1 font-mono text-[9px] uppercase tracking-wider',
                            statusLabel.includes('here')
                              ? 'border-primary/40 bg-primary/10 text-primary'
                              : 'border-warning/40 bg-warning/10 text-warning',
                          ].join(' ')}
                        >
                          {statusLabel}
                        </span>
                      {/if}
                    </div>
                    <div
                      class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                    >
                      {candidateProviderLabel(candidate)}
                      {#if candidate.subtitle}
                        <span> · {candidate.subtitle}</span>
                      {/if}
                    </div>
                    <div class="truncate font-mono text-[10px] text-muted-foreground/70">
                      {candidate.linkName ?? candidate.externalId}
                    </div>
                  </div>
                  <span
                    class="mt-1 inline-flex shrink-0 items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                  >
                    link <Link2 class="size-3" />
                  </span>
                </button>
              </li>
            {/each}
          </ul>
        {:else}
          <div
            class="flex flex-col items-center justify-center gap-1 py-8 text-xs text-muted-foreground"
          >
            <span>no matches</span>
            {#if !searchDebounced}
              <span class="text-[10.5px] text-muted-foreground/70">start typing to search</span>
            {/if}
          </div>
        {/if}
      </div>
    </div>


    </Dialog.Body><Dialog.Footer>
      <Button variant="ghost" onclick={() => (addOpen = false)}>Close</Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>

<AlertDialog.Root
  open={unlinkTarget !== null}
  onOpenChange={(v) => {
    if (!v) unlinkTarget = null;
  }}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Unlink this vendor record?</AlertDialog.Title>
      <AlertDialog.Description>
        {#if unlinkTarget}
          Removes the binding between
          <span class="font-mono text-foreground"
            >{unlinkTarget.provider}:{unlinkTarget.externalId}</span
          >
          and this {canonicalType}. The next pipeline run may re-establish this link automatically.
        {/if}
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <Button
        variant="destructive"
        disabled={unlinkMut.isPending}
        onclick={() => unlinkTarget?.id && unlinkMut.mutate(unlinkTarget.id)}
      >
        Unlink
      </Button>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>
