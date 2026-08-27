<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { LayoutDashboard, Pencil, Plus, Star } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import ScopeBar from '../reports/_components/scope-bar.svelte';
  import KpiTile from '../dashboards/[id]/_components/kpi-tile.svelte';
  import { showErrorToast } from '$lib/utils/errors';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canManage = $derived(authStore.isAllowed('Reports.Write'));
  let selectedId = $state('');
  let initialized = $state(false);
  const dashboards = createQuery(() => ({ queryKey: ['dashboards.list'], queryFn: () => trpc.dashboards.list.query() }));
  const sources = createQuery(() => ({ queryKey: ['reports.listSources'], queryFn: () => trpc.reports.listSources.query(), staleTime: 300_000 }));
  const prefs = createQuery(() => ({ queryKey: ['reports.getMyPrefs'], queryFn: () => trpc.reports.getMyPrefs.query() }));
  const activeDashboard = createQuery(() => ({ queryKey: ['dashboards.byId', selectedId], queryFn: () => selectedId ? trpc.dashboards.byId.query({ id: selectedId }) : Promise.resolve(null), enabled: Boolean(selectedId) }));
  const options = $derived((dashboards.data ?? []).map((dashboard) => ({ value: dashboard.id, label: dashboard.name })));
  const isLoadingDashboard = $derived(
    dashboards.isPending || prefs.isPending || (Boolean(selectedId) && activeDashboard.isPending),
  );
  $effect(() => { if (initialized || !dashboards.data || prefs.isPending) return; selectedId = prefs.data?.landingDashboardId ?? dashboards.data[0]?.id ?? ''; initialized = true; });
  async function setDefault() {
    if (!selectedId) return;
    try { await trpc.reports.saveMyPrefs.mutate({ landingDashboardId: selectedId }); await queryClient.invalidateQueries({ queryKey: ['reports.getMyPrefs'] }); toast.success('Default dashboard updated'); }
    catch (error) { showErrorToast(error, 'Failed to update default dashboard'); }
  }
</script>

<div class="size-full overflow-auto"><div class="flex min-h-full flex-col gap-6 p-6">
  <header class="flex flex-col justify-between gap-4 border-b pb-5 lg:flex-row lg:items-end">
    <div class="space-y-1"><h1 class="text-3xl font-semibold tracking-tight">{activeDashboard.data?.name ?? 'Overview'}</h1><p class="text-sm text-muted-foreground">{activeDashboard.data?.description ?? 'Choose the operational signals your team needs first.'}</p></div>
    <div class="flex flex-wrap items-center gap-2"><div class="w-56"><SingleSelect options={options} bind:selected={selectedId} placeholder="Choose dashboard" searchPlaceholder="Search dashboards…" /></div><ScopeBar />{#if selectedId && prefs.data?.landingDashboardId !== selectedId}<Button variant="outline" size="sm" class="gap-2" onclick={setDefault}><Star class="size-4" />Set as default</Button>{/if}{#if canManage && selectedId}<Button variant="outline" size="sm" class="gap-2" onclick={() => goto(`/dashboards/${selectedId}`)}><Pencil class="size-4" />Edit</Button>{/if}{#if canManage}<Button size="sm" class="gap-2" onclick={() => goto('/dashboards/new')}><Plus class="size-4" />New dashboard</Button>{/if}</div>
  </header>
  {#if isLoadingDashboard}<div class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{#each Array(4) as _}<div class="h-32 animate-pulse rounded-lg border bg-muted/30"></div>{/each}</div>
  {:else if activeDashboard.data?.tiles.length}<section class="grid auto-rows-min gap-4 md:grid-cols-4">{#each activeDashboard.data.tiles as row (row.id)}{@const viz = (row.viz ?? {}) as { tone?: 'neutral' | 'primary' | 'warning' | 'danger' | 'success'; caption?: string; width?: string; height?: string; format?: string; groupBy?: string; thresholds?: Array<{ at: number; tone: 'neutral' | 'primary' | 'warning' | 'danger' | 'success' }> }}{@const inline = (row.inlineDef ?? {}) as { source?: string; definition?: { filters?: Array<{ column: string; operator: string; value?: string | number | boolean }> } }}{@const route = sources.data?.find((source) => source.table === inline.source)?.route ?? null}<div class={viz.width === '4' ? 'md:col-span-4' : viz.width === '3' ? 'md:col-span-3' : viz.width === '2' ? 'md:col-span-2' : 'md:col-span-1'}><KpiTile tile={{ key: row.id, id: row.id, title: row.title, kind: row.kind, tone: viz.tone ?? 'neutral', caption: viz.caption ?? '', width: viz.width, height: viz.height, format: viz.format, route, filters: inline.definition?.filters ?? [], groupBy: viz.groupBy, thresholds: viz.thresholds }} /></div>{/each}</section>
  {:else}<section class="rounded-xl border border-dashed bg-muted/20 px-6 py-16 text-center"><LayoutDashboard class="text-muted-foreground mx-auto mb-3 size-8" /><h2 class="font-semibold">{selectedId ? 'This dashboard is ready for its first widget' : 'No dashboards yet'}</h2><p class="text-muted-foreground mx-auto mt-1 max-w-md text-sm">{selectedId ? (canManage ? 'Create a KPI widget from a live data source, then arrange it for your team.' : 'Ask a dashboard manager to choose the KPIs this team should monitor.') : (canManage ? 'Create a dashboard to collect the KPI widgets your team needs to monitor.' : 'Ask a dashboard manager to create and choose the KPIs this team should monitor.')}</p>{#if canManage}<Button class="mt-5" onclick={() => goto(selectedId ? `/dashboards/${selectedId}` : '/dashboards/new')}>{selectedId ? 'Add widget' : 'Create dashboard'}</Button>{/if}</section>{/if}
</div></div>
