<script lang="ts">
  import { page } from '$app/state';
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import { cn } from '$lib/utils';
  import * as Card from '$lib/components/ui/card/index.js';
  import { ArrowLeft } from '@lucide/svelte';
  import AlertsTable from '$lib/components/alerts/alerts-table.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const siteId = $derived(page.params.id ?? '');

  const siteQuery = createQuery(() => ({
    queryKey: ['sites.get', siteId],
    queryFn: () => trpc.sites.get.query({ id: siteId }),
    enabled: !!siteId,
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['integrationLinks.list', { siteId }],
    queryFn: () => trpc.integrationLinks.list.query({ siteId }),
    enabled: !!siteId,
  }));

  const alertSummaryQuery = createQuery(() => ({
    queryKey: ['alerts.summaryByLink', { siteId }],
    queryFn: () => {
      const linkIds = (linksQuery.data ?? []).map((l) => l.id);
      return trpc.alerts.summaryByLink.query({ linkIds });
    },
    enabled: !!linksQuery.data?.length,
  }));

  const links = $derived(linksQuery.data ?? []);

  const integrationGroups = $derived.by(() => {
    const groups = new Map<string, typeof links>();
    for (const link of links) {
      const existing = groups.get(link.integrationId) ?? [];
      existing.push(link);
      groups.set(link.integrationId, existing);
    }
    return groups;
  });

  const alertStats = $derived.by(() => {
    const summaries = alertSummaryQuery.data ?? [];
    let total = 0;
    let critical = 0;
    let high = 0;
    for (const s of summaries) {
      total += s.alertCount;
      critical += s.criticalCount;
      high += s.highCount;
    }
    return { total, critical, high, other: total - critical - high };
  });

  const alertLinkOptions = $derived(
    links.map((l) => ({
      id: l.id,
      name: l.name ?? l.externalId ?? l.id,
      siteId: l.siteId,
    }))
  );

  const integrationColors: Record<string, string> = {
    'microsoft-365': 'bg-blue-500/10 text-blue-700 dark:text-blue-300 border-blue-500/20',
    'sophos-partner': 'bg-green-500/10 text-green-700 dark:text-green-300 border-green-500/20',
    dattormm: 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border-orange-500/20',
    cove: 'bg-purple-500/10 text-purple-700 dark:text-purple-300 border-purple-500/20',
  };

  function integrationColor(id: string): string {
    return integrationColors[id] ?? 'bg-muted text-muted-foreground border-border';
  }

  function relativeTime(ts: Date | string | null): string {
    if (!ts) return '—';
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  function linkStatusClass(status: string): string {
    if (status === 'active') return 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400';
    if (status === 'error') return 'bg-destructive/15 text-destructive';
    return 'bg-muted text-muted-foreground';
  }
</script>

<div class="flex flex-col size-full p-4 gap-4 overflow-auto">
  <div class="flex items-center gap-2 text-sm text-muted-foreground shrink-0">
    <a href="/sites" class="hover:text-foreground transition-colors flex items-center gap-1">
      <ArrowLeft class="size-3.5" />
      Sites
    </a>
    <span>/</span>
    {#if siteQuery.isLoading}
      <div class="h-4 w-24 rounded bg-muted animate-pulse"></div>
    {:else}
      <span class="text-foreground">{siteQuery.data?.name ?? 'Unknown'}</span>
    {/if}
  </div>

  {#if siteQuery.isLoading}
    <Loader />
  {:else if siteQuery.data}
    {@const site = siteQuery.data}

    <div class="flex items-start justify-between shrink-0">
      <div class="flex flex-col gap-1">
        <h1 class="text-2xl font-semibold">{site.name}</h1>
        {#if site.description}
          <p class="text-sm text-muted-foreground">{site.description}</p>
        {/if}
      </div>
    </div>

    <div class="grid grid-cols-4 gap-3 shrink-0">
      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Title class="text-xs font-medium text-muted-foreground">Integrations</Card.Title>
        </Card.Header>
        <Card.Content>
          <div class="text-2xl font-bold">{integrationGroups.size}</div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Title class="text-xs font-medium text-muted-foreground">Active Alerts</Card.Title>
        </Card.Header>
        <Card.Content>
          <div class="text-2xl font-bold">{alertStats.total}</div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Title class="text-xs font-medium text-destructive/80">Critical</Card.Title>
        </Card.Header>
        <Card.Content>
          <div class="text-2xl font-bold text-destructive">{alertStats.critical}</div>
        </Card.Content>
      </Card.Root>

      <Card.Root>
        <Card.Header class="pb-2">
          <Card.Title class="text-xs font-medium text-warning">High</Card.Title>
        </Card.Header>
        <Card.Content>
          <div class="text-2xl font-bold text-warning">{alertStats.high}</div>
        </Card.Content>
      </Card.Root>
    </div>

    <div class="shrink-0">
      <h2 class="text-sm font-semibold mb-2">Integration Links</h2>
      {#if linksQuery.isLoading}
        <Loader />
      {:else if links.length === 0}
        <div class="rounded-lg border bg-muted/30 p-6 text-center text-muted-foreground text-sm">
          No integrations linked to this site.
        </div>
      {:else}
        <div class="border rounded-lg bg-card overflow-hidden">
          <table class="w-full text-sm">
            <thead class="border-b bg-muted/30">
              <tr>
                <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground"
                  >Integration</th
                >
                <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Tenant</th
                >
                <th class="text-left px-4 py-2 text-xs font-medium text-muted-foreground w-24"
                  >Status</th
                >
                <th class="text-right px-4 py-2 text-xs font-medium text-muted-foreground w-24"
                  >Alerts</th
                >
                <th class="text-right px-4 py-2 text-xs font-medium text-muted-foreground w-32"
                  >Last Updated</th
                >
              </tr>
            </thead>
            <tbody>
              {#each links as link}
                {@const summary = (alertSummaryQuery.data ?? []).find((s) => s.linkId === link.id)}
                {@const intConfig = INTEGRATIONS[link.integrationId as keyof typeof INTEGRATIONS]}
                <tr class="border-b last:border-b-0 hover:bg-muted/20 transition-colors">
                  <td class="px-4 py-3">
                    <span
                      class={cn(
                        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
                        integrationColor(link.integrationId)
                      )}
                    >
                      {intConfig?.name ?? link.integrationId}
                    </span>
                  </td>
                  <td class="px-4 py-3 font-medium">{link.name ?? link.externalId ?? '—'}</td>
                  <td class="px-4 py-3">
                    <span
                      class={cn(
                        'inline-flex items-center px-2 py-0.5 rounded text-xs font-medium capitalize',
                        linkStatusClass(link.status ?? 'disabled')
                      )}
                    >
                      {link.status ?? 'disabled'}
                    </span>
                  </td>
                  <td class="px-4 py-3 text-right tabular-nums">
                    {#if summary && summary.alertCount > 0}
                      <span class="font-medium">{summary.alertCount}</span>
                      {#if summary.criticalCount > 0}
                        <span class="text-destructive text-xs ml-1"
                          >({summary.criticalCount} crit)</span
                        >
                      {/if}
                    {:else}
                      <span class="text-muted-foreground">0</span>
                    {/if}
                  </td>
                  <td class="px-4 py-3 text-right text-muted-foreground text-xs"
                    >{relativeTime(link.updatedAt)}</td
                  >
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <div class="flex flex-col flex-1 min-h-0">
      <h2 class="text-sm font-semibold mb-2 shrink-0">Alerts</h2>
      <div class="flex size-full min-h-100">
        <AlertsTable {siteId} links={alertLinkOptions} scopeColumn="link" />
      </div>
    </div>
  {:else}
    <p class="text-muted-foreground">Site not found.</p>
  {/if}
</div>
