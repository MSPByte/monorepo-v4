<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import {
    ArrowUpRight,
    Database,
    FileChartColumn,
    Pencil,
    Plus,
    Search,
    Trash2,
    Users,
  } from '@lucide/svelte';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { getPolicyTableShape } from '@mspbyte/shared';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { showErrorToast } from '$lib/utils/errors';
  import ScopeBar from './_components/scope-bar.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWrite = $derived(authStore.isAllowed('Reports.Write'));
  const canDelete = $derived(authStore.isAllowed('Reports.Delete'));
  const reportsQuery = createQuery(() => ({
    queryKey: ['reports.list'],
    queryFn: () => trpc.reports.list.query(),
  }));
  const reports = $derived(
    (reportsQuery.data ?? []).map((report) => ({
      ...report,
      sourceLabel: getPolicyTableShape(report.source)?.label ?? report.source,
    }))
  );
  let search = $state('');
  let source = $state<string | undefined>('all');
  let sort = $state<string | undefined>('updated');
  let currentPage = $state(1);
  let toDelete = $state<{ id: string; name: string } | null>(null);
  let deleting = $state(false);
  const sourceOptions = $derived([
    { value: 'all', label: 'All sources' },
    ...Array.from(
      new Map(reports.map((r) => [r.source, { value: r.source, label: r.sourceLabel }])).values()
    ),
  ]);
  const filtered = $derived(
    reports
      .filter(
        (r) =>
          (source === 'all' || r.source === source) &&
          `${r.name} ${r.description ?? ''} ${r.sourceLabel}`
            .toLowerCase()
            .includes(search.trim().toLowerCase())
      )
      .toSorted((a, b) =>
        sort === 'name'
          ? a.name.localeCompare(b.name)
          : (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.name.localeCompare(b.name)
      )
  );
  const pageCount = $derived(Math.max(1, Math.ceil(filtered.length / 12)));
  const visible = $derived(filtered.slice((currentPage - 1) * 12, currentPage * 12));
  $effect(() => {
    search;
    source;
    sort;
    currentPage = 1;
  });
  $effect(() => {
    if (currentPage > pageCount) currentPage = pageCount;
  });
  function clearFilters() {
    search = '';
    source = 'all';
  }
  function updatedLabel(value: string | null) {
    return value
      ? new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
        }).format(new Date(value))
      : 'Not recorded';
  }
  async function confirmDelete() {
    if (!toDelete || deleting) return;
    deleting = true;
    try {
      await trpc.reports.delete.mutate({ id: toDelete.id });
      toast.success(`Deleted "${toDelete.name}"`);
      toDelete = null;
      await queryClient.invalidateQueries({ queryKey: ['reports.list'] });
    } catch (err) {
      showErrorToast(err, 'Failed to delete report');
    } finally {
      deleting = false;
    }
  }
</script>

<svelte:head><title>Reports · MSPByte</title></svelte:head>

<AlertDialog.Root
  open={toDelete !== null}
  onOpenChange={(open) => !open && !deleting && (toDelete = null)}
>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete “{toDelete?.name}”?</AlertDialog.Title>
      <AlertDialog.Description
        >This permanently removes the saved report. Dashboard tiles using it will be empty until
        another report is selected. Your source data is kept.</AlertDialog.Description
      >
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel disabled={deleting}>Cancel</AlertDialog.Cancel>
      <Button variant="destructive" disabled={deleting} onclick={confirmDelete}
        >{deleting ? 'Deleting…' : 'Delete report'}</Button
      >
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

<div class="rw-library">
  <header class="rw-heading">
    <div class="rw-heading-title">
      <span class="rw-product-icon"><FileChartColumn class="size-5" /></span>
      <div>
        <p class="rw-eyebrow">Reporting</p>
        <h1>Reports</h1>
      </div>
    </div>
    {#if canWrite}<Button href="/reports/builder" size="sm"
        ><Plus class="size-4" />New report</Button
      >{/if}
  </header>

  <section class="rw-intro" aria-labelledby="reports-intro">
    <div>
      <p class="rw-eyebrow">Your report library</p>
      <h2 id="reports-intro">A clearer view of your client data.</h2>
      <p>
        Build reusable reports across your integrations. Open a report to explore the results,
        refine the view, and export what you need.
      </p>
    </div>
    <div class="rw-intro-note">
      <Users class="size-5" />
      <div>
        <strong>Built to share with your team</strong>
        <p>Saved reports are available to teammates with reporting access.</p>
      </div>
    </div>
  </section>

  <div class="rw-scope">
    <div>
      <strong>Report scope</strong>
      <p>Choose whose data appears when you open a report. This also applies to your dashboards.</p>
    </div>
    <ScopeBar />
  </div>

  <section class="rw-library-section" aria-labelledby="saved-reports">
    <div class="rw-section-heading">
      <h2 id="saved-reports">
        Saved reports <span>{reportsQuery.isSuccess ? reports.length : '—'}</span>
      </h2>
      <p>Open a report to view its latest data.</p>
    </div>
    <div class="rw-toolbar">
      <div class="rw-search">
        <Search class="size-4" /><Input
          bind:value={search}
          placeholder="Search reports, descriptions, or sources…"
          aria-label="Search reports"
        />
      </div>
      <div class="rw-pickers">
        <SingleSelect
          options={sourceOptions}
          bind:selected={source}
          allowClear={false}
          aria-label="Filter by source"
          class="rw-source-picker"
        /><SingleSelect
          options={[
            { value: 'updated', label: 'Recently updated' },
            { value: 'name', label: 'Name A–Z' },
          ]}
          bind:selected={sort}
          allowClear={false}
          aria-label="Sort reports"
          class="rw-sort-picker"
        />
      </div>
    </div>
    {#if reportsQuery.isPending}
      <div class="rw-empty" role="status">
        <FileChartColumn class="size-7" />
        <h3>Loading your reports…</h3>
        <p>Getting your saved report library.</p>
      </div>
    {:else if reportsQuery.isError}
      <div class="rw-empty" role="alert">
        <h3>Reports couldn’t be loaded</h3>
        <p>Try again to retrieve your saved reports.</p>
        <Button variant="outline" onclick={() => reportsQuery.refetch()}>Try again</Button>
      </div>
    {:else if reports.length === 0}
      <div class="rw-empty">
        <FileChartColumn class="size-8" />
        <h3>Your first report starts here</h3>
        <p>
          {canWrite
            ? 'Choose a data source, add the columns you need, and save a view your team can use again.'
            : 'Reports created by your team will appear here. Ask a teammate with reporting edit access to create one.'}
        </p>
        {#if canWrite}<Button href="/reports/builder"><Plus class="size-4" />Create a report</Button
          >{/if}
      </div>
    {:else if filtered.length === 0}
      <div class="rw-empty">
        <Search class="size-7" />
        <h3>No matching reports</h3>
        <p>Try a different search or include all data sources.</p>
        <Button variant="outline" onclick={clearFilters}>Clear filters</Button>
      </div>
    {:else}
      <div class="rw-result-count" role="status">
        {filtered.length} report{filtered.length === 1 ? '' : 's'}{search.trim() || source !== 'all'
          ? ` matching your filters`
          : ''}{#if search.trim() || source !== 'all'}<button onclick={clearFilters}
            >Clear filters</button
          >{/if}
      </div>
      <div class="rw-report-grid">
        {#each visible as report (report.id)}
          <article class="rw-report-card">
            <div class="rw-card-source">
              <Database class="size-3.5" /><span>{report.sourceLabel}</span>
            </div>
            <a class="rw-report-link" href={`/reports/${report.id}`}
              ><h3>{report.name}</h3>
              <ArrowUpRight class="size-4" /></a
            >
            <p class="rw-description">
              {report.description || 'Open this report to explore the latest results.'}
            </p>
            <footer>
              <span
                >Updated <time datetime={report.updatedAt ?? undefined}
                  >{updatedLabel(report.updatedAt)}</time
                ></span
              >
              <div>
                {#if canWrite}<Button
                    href={`/reports/builder?id=${report.id}`}
                    variant="ghost"
                    size="icon"
                    class="size-8"
                    aria-label={`Edit ${report.name}`}><Pencil class="size-3.5" /></Button
                  >{/if}{#if canDelete}<Button
                    variant="ghost"
                    size="icon"
                    class="size-8 text-muted-foreground hover:text-destructive"
                    aria-label={`Delete ${report.name}`}
                    onclick={() => (toDelete = report)}><Trash2 class="size-3.5" /></Button
                  >{/if}
              </div>
            </footer>
          </article>
        {/each}
      </div>
      {#if pageCount > 1}<nav class="rw-pagination" aria-label="Report pages">
          <span>Page {currentPage} of {pageCount}</span>
          <div>
            <Button
              variant="outline"
              size="sm"
              disabled={currentPage === 1}
              onclick={() => currentPage--}>Previous</Button
            ><Button
              variant="outline"
              size="sm"
              disabled={currentPage === pageCount}
              onclick={() => currentPage++}>Next</Button
            >
          </div>
        </nav>{/if}
    {/if}
  </section>
</div>
