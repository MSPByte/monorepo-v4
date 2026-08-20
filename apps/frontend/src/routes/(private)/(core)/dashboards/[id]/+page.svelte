<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { ArrowLeft, Pin, Plus, Save, Trash2 } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Textarea } from '$lib/components/ui/textarea/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { showErrorToast } from '$lib/utils/errors';
  import ScopeBar from '../../reports/_components/scope-bar.svelte';
  import KpiTile from './_components/kpi-tile.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Reports.Write'));
  const canDelete = $derived(authStore.isAllowed('Reports.Delete'));

  const idParam = $derived(page.params.id);
  const isNew = $derived(idParam === 'new');
  const dashboardId = $derived(isNew ? '' : idParam);

  type Tone = 'neutral' | 'primary' | 'warning' | 'danger' | 'success';
  type TileDraft = {
    // Client-only key so unsaved tiles have a stable identity across renders.
    key: string;
    id?: string;
    title: string;
    reportId: string;
    tone: Tone;
    caption: string;
  };

  // -- state -----------------------------------------------------------------

  let hydrated = $state(false);
  let name = $state('');
  let description = $state('');
  let tiles = $state<TileDraft[]>([]);
  let saving = $state(false);
  let deleting = $state(false);

  // -- queries ---------------------------------------------------------------

  const dashboardQuery = createQuery(() => ({
    queryKey: ['dashboards.byId', dashboardId],
    queryFn: () =>
      dashboardId ? trpc.dashboards.byId.query({ id: dashboardId }) : Promise.resolve(null),
  }));

  const reportsListQuery = createQuery(() => ({
    queryKey: ['reports.list'],
    queryFn: () => trpc.reports.list.query(),
    staleTime: 60_000,
  }));

  const prefsQuery = createQuery(() => ({
    queryKey: ['reports.getMyPrefs'],
    queryFn: () => trpc.reports.getMyPrefs.query(),
    staleTime: 60_000,
  }));

  // -- derived ---------------------------------------------------------------

  const reportOptions = $derived(
    (reportsListQuery.data ?? []).map((r) => ({ value: r.id, label: r.name })),
  );
  const isPinned = $derived(
    Boolean(dashboardId) && prefsQuery.data?.landingDashboardId === dashboardId,
  );

  // -- hydrate ---------------------------------------------------------------

  let uidCounter = 1;

  $effect(() => {
    if (hydrated) return;
    if (isNew) {
      hydrated = true;
      return;
    }
    if (!dashboardQuery.data) return;
    const d = dashboardQuery.data;
    name = d.name;
    description = d.description ?? '';
    tiles = (d.tiles ?? []).map((t) => {
      const viz = (t.viz ?? {}) as { tone?: Tone; caption?: string };
      return {
        key: `t${uidCounter++}`,
        id: t.id,
        title: t.title,
        reportId: t.reportId ?? '',
        tone: viz.tone ?? 'neutral',
        caption: viz.caption ?? '',
      };
    });
    hydrated = true;
  });

  // -- tile editor sheet -----------------------------------------------------

  let editorOpen = $state(false);
  let editorKey = $state<string | null>(null);
  let draftTitle = $state('');
  let draftReportId = $state('');
  let draftTone = $state<Tone>('neutral');
  let draftCaption = $state('');

  function openNewTile() {
    editorKey = null;
    draftTitle = '';
    draftReportId = '';
    draftTone = 'neutral';
    draftCaption = '';
    editorOpen = true;
  }

  function openEditTile(tile: TileDraft) {
    editorKey = tile.key;
    draftTitle = tile.title;
    draftReportId = tile.reportId;
    draftTone = tile.tone;
    draftCaption = tile.caption;
    editorOpen = true;
  }

  function commitTile() {
    if (!draftTitle.trim()) {
      toast.error('Give the tile a title.');
      return;
    }
    if (!draftReportId) {
      toast.error('Pick the report this tile counts.');
      return;
    }
    if (editorKey === null) {
      tiles = [
        ...tiles,
        {
          key: `t${uidCounter++}`,
          title: draftTitle.trim(),
          reportId: draftReportId,
          tone: draftTone,
          caption: draftCaption.trim(),
        },
      ];
    } else {
      tiles = tiles.map((tile) =>
        tile.key === editorKey
          ? {
              ...tile,
              title: draftTitle.trim(),
              reportId: draftReportId,
              tone: draftTone,
              caption: draftCaption.trim(),
            }
          : tile,
      );
    }
    editorOpen = false;
  }

  function removeTile(key: string) {
    tiles = tiles.filter((tile) => tile.key !== key);
  }

  // -- save / delete / pin ---------------------------------------------------

  async function save() {
    if (!canWrite) return;
    if (!name.trim()) {
      toast.error('Give the dashboard a name.');
      return;
    }
    saving = true;
    try {
      const saved = await trpc.dashboards.save.mutate({
        id: dashboardId || undefined,
        name: name.trim(),
        description: description.trim() || null,
        layout: [],
        tiles: tiles.map((tile) => ({
          title: tile.title,
          kind: 'kpi',
          reportId: tile.reportId,
          viz: {
            aggregation: 'count',
            tone: tile.tone,
            format: 'number',
            caption: tile.caption || undefined,
          },
        })),
      });
      toast.success(isNew ? 'Dashboard created' : 'Dashboard saved');
      await queryClient.invalidateQueries({ queryKey: ['dashboards.list'] });
      if (isNew && saved?.id) {
        await goto(`/dashboards/${saved.id}`);
      } else {
        await queryClient.invalidateQueries({ queryKey: ['dashboards.byId', dashboardId] });
      }
    } catch (err) {
      showErrorToast(err, 'Failed to save dashboard');
    } finally {
      saving = false;
    }
  }

  async function del() {
    if (isNew || !dashboardId) return;
    deleting = true;
    try {
      await trpc.dashboards.delete.mutate({ id: dashboardId });
      toast.success('Dashboard deleted');
      await queryClient.invalidateQueries({ queryKey: ['dashboards.list'] });
      await goto('/dashboards');
    } catch (err) {
      showErrorToast(err, 'Failed to delete dashboard');
      deleting = false;
    }
  }

  async function togglePin() {
    if (isNew || !dashboardId) return;
    try {
      await trpc.reports.saveMyPrefs.mutate({
        landingDashboardId: isPinned ? null : dashboardId,
      });
      toast.success(isPinned ? 'Landing page cleared' : 'Pinned as landing page');
      await queryClient.invalidateQueries({ queryKey: ['reports.getMyPrefs'] });
    } catch (err) {
      showErrorToast(err, 'Failed to update landing page');
    }
  }
</script>

<Sheet.Root bind:open={editorOpen}>
  <Sheet.Content class="sm:max-w-md">
    <Sheet.Header>
      <Sheet.Title>{editorKey === null ? 'Add tile' : 'Edit tile'}</Sheet.Title>
      <Sheet.Description>KPI tile — shows the row count of the linked report.</Sheet.Description>
    </Sheet.Header>
    <div class="space-y-4 px-4 pb-4">
      <div class="space-y-2">
        <Label for="tile-title">Title</Label>
        <Input id="tile-title" bind:value={draftTitle} placeholder="Identities without MFA" />
      </div>
      <div class="space-y-2">
        <Label>Report</Label>
        <SingleSelect
          options={reportOptions}
          bind:selected={draftReportId}
          placeholder="Pick a report"
          searchPlaceholder="Search reports…"
        />
        {#if reportOptions.length === 0}
          <p class="text-muted-foreground text-xs">
            No reports yet. Create one first, then add tiles here.
          </p>
        {/if}
      </div>
      <div class="space-y-2">
        <Label>Tone</Label>
        <div class="grid grid-cols-5 gap-1">
          {#each ['neutral', 'primary', 'warning', 'danger', 'success'] as tone}
            <button
              type="button"
              onclick={() => (draftTone = tone as Tone)}
              class="rounded-md border px-2 py-1.5 text-[11px] capitalize transition-colors {draftTone ===
              tone
                ? 'border-primary bg-primary/5'
                : 'border-input text-muted-foreground hover:bg-accent'}"
            >
              {tone}
            </button>
          {/each}
        </div>
      </div>
      <div class="space-y-2">
        <Label for="tile-caption">Caption</Label>
        <Input id="tile-caption" bind:value={draftCaption} placeholder="Optional context line" />
      </div>
    </div>
    <Sheet.Footer>
      <Button variant="ghost" onclick={() => (editorOpen = false)}>Cancel</Button>
      <Button onclick={commitTile}>{editorKey === null ? 'Add tile' : 'Save tile'}</Button>
    </Sheet.Footer>
  </Sheet.Content>
</Sheet.Root>

<div class="flex size-full flex-col overflow-hidden">
  <!-- Header -->
  <div class="flex items-center justify-between gap-3 border-b px-6 py-3">
    <div class="flex items-center gap-3">
      <Button variant="ghost" size="sm" class="gap-2" onclick={() => goto('/dashboards')}>
        <ArrowLeft class="size-4" />
        Dashboards
      </Button>
      <div class="text-muted-foreground text-sm">
        {isNew ? 'New dashboard' : 'Edit dashboard'}
      </div>
    </div>
    <div class="flex items-center gap-2">
      {#if !isNew}
        <Button variant="ghost" size="sm" class="gap-2" onclick={togglePin}>
          <Pin class="size-4 {isPinned ? 'fill-current' : ''}" />
          {isPinned ? 'Unpin' : 'Pin as landing'}
        </Button>
      {/if}
      {#if !isNew && canDelete}
        <Button variant="ghost" size="sm" class="gap-2" disabled={deleting} onclick={del}>
          <Trash2 class="size-4" />
          Delete
        </Button>
      {/if}
      <ScopeBar />
      {#if canWrite}
        <Button size="sm" class="gap-2" disabled={saving} onclick={save}>
          <Save class="size-4" />
          {isNew ? 'Create dashboard' : 'Save changes'}
        </Button>
      {/if}
    </div>
  </div>

  <div class="min-h-0 flex-1 overflow-y-auto p-6">
    <div class="mx-auto flex max-w-6xl flex-col gap-6">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div class="space-y-2">
          <Label for="db-name">Name</Label>
          <Input id="db-name" bind:value={name} placeholder="M365 hygiene" />
        </div>
        <div class="space-y-2">
          <Label for="db-desc">Description</Label>
          <Input id="db-desc" bind:value={description} placeholder="Optional." />
        </div>
      </div>

      <div>
        <div class="mb-3 flex items-baseline justify-between">
          <div>
            <h2 class="text-sm font-semibold">Tiles</h2>
            <p class="text-muted-foreground text-xs">
              Each tile counts the rows of a saved report, scoped by your current filter.
            </p>
          </div>
          {#if canWrite}
            <Button
              size="sm"
              variant="outline"
              class="gap-2"
              disabled={reportOptions.length === 0}
              onclick={openNewTile}
            >
              <Plus class="size-4" />
              Add tile
            </Button>
          {/if}
        </div>

        {#if tiles.length === 0}
          <div
            class="text-muted-foreground rounded-lg border border-dashed py-14 text-center text-sm"
          >
            {#if reportOptions.length === 0}
              Create a report first, then add tiles here.
            {:else}
              No tiles yet. Add one to start.
            {/if}
          </div>
        {:else}
          <div class="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {#each tiles as tile (tile.key)}
              <KpiTile
                {tile}
                editable={canWrite}
                onedit={() => openEditTile(tile)}
                onremove={() => removeTile(tile.key)}
              />
            {/each}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
