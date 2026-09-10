<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import {
    ArrowRight,
    LayoutDashboard,
    Pencil,
    Plus,
    RefreshCw,
    Star,
    TriangleAlert,
  } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import ScopeBar from '../reports/_components/scope-bar.svelte';
  import KpiTile from '$lib/components/domain/dashboard-tile.svelte';
  import { showErrorToast } from '$lib/utils/errors';
  import { STALE } from '$lib/query';

  type TileViz = {
    tone?: 'neutral' | 'primary' | 'warning' | 'danger' | 'success';
    caption?: string;
    width?: string;
    height?: string;
    format?: string;
    groupBy?: string;
    thresholds?: Array<{
      at: number;
      tone: 'neutral' | 'primary' | 'warning' | 'danger' | 'success';
    }>;
  };
  type TileInline = {
    source?: string;
    definition?: {
      filters?: Array<{ column: string; operator: string; value?: string | number | boolean }>;
    };
  };

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canManage = $derived(authStore.isAllowed('Reports.Write'));

  let chosenId = $state('');
  let savingDefault = $state(false);
  let refreshing = $state(false);

  const dashboards = createQuery(() => ({
    queryKey: ['dashboards.list'],
    queryFn: () => trpc.dashboards.list.query(),
  }));
  const sources = createQuery(() => ({
    queryKey: ['reports.listSources'],
    queryFn: () => trpc.reports.listSources.query(),
    staleTime: STALE.DASHBOARD,
  }));
  const prefs = createQuery(() => ({
    queryKey: ['reports.getMyPrefs'],
    queryFn: () => trpc.reports.getMyPrefs.query(),
  }));
  const selectedId = $derived.by(() => {
    if (prefs.isPending) return '';
    const available = dashboards.data ?? [];
    return (
      available.find((d) => d.id === chosenId)?.id ??
      available.find((d) => d.id === prefs.data?.landingDashboardId)?.id ??
      available[0]?.id ??
      ''
    );
  });

  const activeDashboard = createQuery(() => ({
    queryKey: ['dashboards.byId', selectedId],
    queryFn: () =>
      selectedId ? trpc.dashboards.byId.query({ id: selectedId }) : Promise.resolve(null),
    enabled: Boolean(selectedId),
  }));

  const options = $derived(
    (dashboards.data ?? []).map((d) => ({
      value: d.id,
      label: d.name,
      subLabel: `${d.tileCount} ${d.tileCount === 1 ? 'widget' : 'widgets'}${prefs.data?.landingDashboardId === d.id ? ' · Your default' : ''}`,
    }))
  );
  const isLoadingDashboard = $derived(
    dashboards.isPending || prefs.isPending || (Boolean(selectedId) && activeDashboard.isPending)
  );

  async function setDefault() {
    if (!selectedId || savingDefault) return;
    savingDefault = true;
    try {
      await trpc.reports.saveMyPrefs.mutate({ landingDashboardId: selectedId });
      await queryClient.invalidateQueries({ queryKey: ['reports.getMyPrefs'] });
      toast.success('Default dashboard updated');
    } catch (error) {
      showErrorToast(error, 'Failed to update default dashboard');
    } finally {
      savingDefault = false;
    }
  }

  async function refreshWidgets() {
    if (refreshing) return;
    refreshing = true;
    try {
      await queryClient.invalidateQueries(
        { queryKey: ['dashboards.runTile'] },
        { throwOnError: true }
      );
    } catch (error) {
      showErrorToast(error, 'Some widgets could not be refreshed. Try again.');
    } finally {
      refreshing = false;
    }
  }

  function colSpanClass(width?: string) {
    if (width === '4') return 'md:col-span-4';
    if (width === '3') return 'md:col-span-3';
    if (width === '2') return 'md:col-span-2';
    return 'md:col-span-1';
  }
</script>

<div class="home-page">
  <header class="home-heading">
    <div>
      <p class="home-eyebrow">Overview / Dashboard</p>
      <h1>{activeDashboard.data?.name ?? 'Your overview'}</h1>
      <p>
        {activeDashboard.data?.description ||
          'The signals your team follows, with the site context you need.'}
      </p>
    </div>
    <div class="home-actions">
      {#if canManage && activeDashboard.data}
        <Button variant="outline" size="sm" href={`/dashboards/${selectedId}`}>
          <Pencil class="size-3.5" />Edit dashboard
        </Button>
      {/if}
      {#if canManage}
        <Button size="sm" href="/dashboards/new"><Plus class="size-3.5" />New dashboard</Button>
      {/if}
    </div>
  </header>

  {#if dashboards.data?.length}
    <section class="home-toolbar" aria-label="Dashboard controls">
      <div class="home-picker">
        <span class="home-control-label">Dashboard</span>
        <SingleSelect
          {options}
          selected={selectedId}
          onchange={(id) => (chosenId = id)}
          allowClear={false}
          disabled={prefs.isPending}
          aria-label="Choose dashboard"
          placeholder="Choose dashboard"
          searchPlaceholder="Search dashboards…"
        />
      </div>
      <div class="home-scope">
        <span class="home-control-label">Showing data for</span>
        {#if !prefs.isError}<ScopeBar />{:else}<span class="text-xs text-muted-foreground"
            >Scope unavailable</span
          >{/if}
      </div>
      <div class="home-toolbar-actions">
        {#if selectedId && !prefs.isError}
          {#if prefs.data?.landingDashboardId === selectedId}
            <span class="home-default"><Star class="size-3.5" />Your default</span>
          {:else}
            <Button
              variant="ghost"
              size="sm"
              disabled={savingDefault || !activeDashboard.data}
              onclick={setDefault}
            >
              <Star class="size-3.5" />{savingDefault ? 'Saving…' : 'Make default'}
            </Button>
          {/if}
        {/if}
      </div>
    </section>
  {/if}

  {#if prefs.isError}
    <div class="home-notice" role="alert">
      <TriangleAlert class="size-4 shrink-0" />
      <p>
        Your saved preferences could not be loaded. Retry to confirm your default dashboard and site
        scope.
      </p>
      <Button
        variant="outline"
        size="sm"
        disabled={prefs.isFetching}
        onclick={() => prefs.refetch()}>Retry preferences</Button
      >
    </div>
  {/if}

  {#if dashboards.isError || (selectedId && activeDashboard.isError)}
    <section class="home-empty" role="alert">
      <div class="home-empty-icon"><TriangleAlert class="size-6" /></div>
      <h2>
        {dashboards.isError
          ? 'Dashboards could not be loaded'
          : 'This dashboard could not be loaded'}
      </h2>
      <p>Try again, or choose another dashboard if this one is no longer available.</p>
      <Button
        variant="outline"
        disabled={dashboards.isFetching || activeDashboard.isFetching}
        onclick={() => (dashboards.isError ? dashboards.refetch() : activeDashboard.refetch())}
        >Try again</Button
      >
    </section>
  {:else if isLoadingDashboard}
    <div role="status">
      <span class="sr-only">Loading dashboard…</span>
      <div class="grid gap-4 sm:grid-cols-2 lg:grid-cols-4" aria-hidden="true">
        {#each Array(4) as _}
          <div class="h-40 motion-safe:animate-pulse rounded-xl border bg-card"></div>
        {/each}
      </div>
    </div>
  {:else if activeDashboard.data?.tiles.length}
    <section aria-label="Dashboard widgets" class="home-widgets">
      <div class="home-section-heading">
        <div>
          <h2>At a glance <span>{activeDashboard.data.tiles.length}</span></h2>
          <p>Open a linked metric to explore the records behind it.</p>
        </div>
        <Button variant="outline" size="sm" disabled={refreshing} onclick={refreshWidgets}>
          <RefreshCw class="size-3.5 {refreshing ? 'motion-safe:animate-spin' : ''}" />{refreshing
            ? 'Refreshing…'
            : 'Refresh widgets'}
        </Button>
      </div>
      <div class="grid auto-rows-min gap-4 md:grid-cols-4">
        {#each activeDashboard.data.tiles as row (row.id)}
          {@const viz = (row.viz ?? {}) as TileViz}
          {@const inline = (row.inlineDef ?? {}) as TileInline}
          {@const route = sources.data?.find((s) => s.table === inline.source)?.route ?? null}
          <div class={`min-w-0 ${colSpanClass(viz.width)}`}>
            <KpiTile
              tile={{
                key: row.id,
                id: row.id,
                title: row.title,
                kind: row.kind,
                tone: viz.tone ?? 'neutral',
                caption: viz.caption ?? '',
                width: viz.width,
                height: viz.height,
                format: viz.format,
                route,
                filters: inline.definition?.filters ?? [],
                groupBy: viz.groupBy,
                thresholds: viz.thresholds,
              }}
            />
          </div>
        {/each}
      </div>
    </section>
  {:else}
    <section class="home-empty">
      <div class="home-empty-icon"><LayoutDashboard class="size-6" /></div>
      <p class="home-eyebrow">{selectedId ? 'Build your view' : 'Start with what matters'}</p>
      <h2>
        {selectedId ? 'Give your team a clear first look' : 'Your first dashboard starts here'}
      </h2>
      <p>
        {#if canManage}
          {selectedId
            ? 'Add a widget to follow a metric, compare sites, or spot changes in your data.'
            : 'Bring the metrics your team checks every day into one view. Create a dashboard, then add your first widget.'}
        {:else}
          Ask a dashboard manager to {selectedId
            ? 'add the metrics'
            : 'create a dashboard with the metrics'} your team needs to follow.
        {/if}
      </p>
      {#if canManage}
        <Button href={selectedId ? `/dashboards/${selectedId}` : '/dashboards/new'}>
          <Plus class="size-4" />{selectedId ? 'Add first widget' : 'Create dashboard'}
        </Button>
      {/if}
      <a class="home-text-link" href="/home/sites"
        >View site findings <ArrowRight class="size-3.5" /></a
      >
    </section>
  {/if}
</div>
