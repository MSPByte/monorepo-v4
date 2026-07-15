<script lang="ts">
  import { getContext } from 'svelte';
  import { createMutation, createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import MetricCard from '$lib/components/domain/metric-card.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import * as Card from '$lib/components/ui/card';
  import * as Table from '$lib/components/ui/table';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import { Badge } from '$lib/components/ui/badge';
  import Plus from '@lucide/svelte/icons/plus';
  import RefreshCw from '@lucide/svelte/icons/refresh-cw';
  import Trash2 from '@lucide/svelte/icons/trash-2';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  const reportQuery = createQuery(() => ({
    queryKey: ['billing.report'],
    queryFn: () => trpc.billing.report.query(),
  }));

  const rulesQuery = createQuery(() => ({
    queryKey: ['billing.rules'],
    queryFn: () => trpc.billing.rules.query(),
  }));

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query(),
  }));

  const linksQuery = createQuery(() => ({
    queryKey: ['pipeline.syncableLinks'],
    queryFn: () => trpc.pipeline.syncableLinks.query(),
  }));

  const haloLink = $derived(
    linksQuery.data?.find((l) => l.integrationId === 'halopsa' && l.status === 'active'),
  );

  let pendingRunId = $state<string | null>(null);

  const runStatusQuery = createQuery(() => ({
    queryKey: ['pipeline.recentRuns', haloLink?.id ?? ''],
    queryFn: () =>
      trpc.pipeline.recentRuns.query({ linkId: haloLink!.id, limit: 5 }),
    refetchInterval: pendingRunId ? 3_000 : false,
    enabled: Boolean(haloLink && pendingRunId),
  }));

  const TERMINAL_STATUSES = new Set([
    'completed',
    'failed',
    'normalize_failed',
    'policy_failed',
    'projection_failed',
    'enqueue_failed',
  ]);

  $effect(() => {
    if (!pendingRunId || !runStatusQuery.data) return;
    const match = runStatusQuery.data.find((r) => r.id === pendingRunId);
    if (match && TERMINAL_STATUSES.has(match.status)) {
      if (match.status === 'completed') {
        toast.success('Halo sync completed');
        qc.invalidateQueries({ queryKey: ['billing.report'] });
        qc.invalidateQueries({ queryKey: ['billing.previewRule'] });
      } else {
        toast.error(`Halo sync ended with status: ${match.status}`);
      }
      pendingRunId = null;
    }
  });

  const refreshHalo = createMutation(() => ({
    mutationFn: () => {
      if (!haloLink) throw new Error('No active HaloPSA link configured');
      return trpc.pipeline.enqueueSync.mutate({
        linkId: haloLink.id,
        type: 'halopsa_recurring_items',
        mode: 'full',
      });
    },
    onSuccess: (result) => {
      toast.success('Halo sync queued — polling for completion…');
      pendingRunId = result.syncRunId;
    },
    onError: (e: unknown) =>
      toast.error(e instanceof Error ? e.message : 'Failed to queue Halo sync'),
  }));

  let name = $state('Sophos Endpoint Protection');
  let siteId = $state('');
  let itemNameContains = $state('Sophos Endpoint');
  let endpointType = $state('all');
  let enabled = $state(true);

  const vendorFilters = $derived.by(() => {
    const filters: Array<{
      column: 'type' | 'deletedAt';
      operator: 'eq' | 'is_null';
      value?: string;
    }> = [{ column: 'deletedAt', operator: 'is_null' }];
    if (endpointType !== 'all') {
      filters.push({ column: 'type', operator: 'eq', value: endpointType });
    }
    return filters;
  });

  const ruleDraft = $derived({
    name,
    enabled,
    siteId: siteId || null,
    psaItemMatch: {
      field: 'itemName' as const,
      operator: 'contains' as const,
      value: itemNameContains,
    },
    vendorProvider: 'sophos-partner' as const,
    vendorFacet: 'sophos_endpoints' as const,
    vendorFilters,
    countMode: 'count_rows' as const,
  });

  const previewQuery = createQuery(() => ({
    queryKey: ['billing.previewRule', ruleDraft],
    queryFn: () => trpc.billing.previewRule.query(ruleDraft),
    enabled: itemNameContains.trim().length > 0,
  }));

  const saveRule = createMutation(() => ({
    mutationFn: () => trpc.billing.upsertRule.mutate(ruleDraft),
    onSuccess: () => {
      toast.success('Rule saved');
      qc.invalidateQueries({ queryKey: ['billing.rules'] });
      qc.invalidateQueries({ queryKey: ['billing.report'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Rule save failed'),
  }));

  const deleteRule = createMutation(() => ({
    mutationFn: (id: string) => trpc.billing.deleteRule.mutate({ id }),
    onSuccess: () => {
      toast.success('Rule deleted');
      qc.invalidateQueries({ queryKey: ['billing.rules'] });
      qc.invalidateQueries({ queryKey: ['billing.report'] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Rule delete failed'),
  }));

  function money(value: number | undefined) {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      maximumFractionDigits: 0,
    }).format(value ?? 0);
  }

  function statusVariant(status: string) {
    if (status === 'underbilled') return 'default';
    if (status === 'overbilled') return 'destructive';
    if (status === 'matched') return 'secondary';
    return 'outline';
  }
</script>

<div class="size-full overflow-auto">
  <div class="flex flex-col gap-6 p-6">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 class="text-2xl font-semibold tracking-normal">Billing Reconciliation</h1>
        <p class="text-sm text-muted-foreground">
          Rule-backed comparison between PSA billing rows and vendor inventory.
        </p>
      </div>
      <Button
        class="gap-2"
        disabled={!haloLink || refreshHalo.isPending || pendingRunId != null}
        onclick={() => refreshHalo.mutate()}
        title={haloLink ? 'Queue a Halo sync' : 'No active HaloPSA link'}
      >
        <RefreshCw class={`size-4 ${pendingRunId ? 'animate-spin' : ''}`} />
        {pendingRunId ? 'Syncing…' : refreshHalo.isPending ? 'Queueing…' : 'Refresh from Halo'}
      </Button>
    </div>

    <div class="grid gap-4 md:grid-cols-4">
      <MetricCard
        label="Underbilled MRR"
        value={money(reportQuery.data?.summary.underbilledMrr)}
        detail={`${reportQuery.data?.summary.underbilledRows ?? 0} affected rows`}
      />
      <MetricCard
        label="Overbilled MRR"
        value={money(reportQuery.data?.summary.overbilledMrr)}
        detail={`${reportQuery.data?.summary.overbilledRows ?? 0} affected rows`}
      />
      <MetricCard
        label="Net MRR Delta"
        value={money(reportQuery.data?.summary.netMrrDelta)}
        detail="Positive means possible revenue"
      />
      <MetricCard
        label="Missing Rules"
        value={reportQuery.data?.summary.missingRuleRows ?? '—'}
        detail={`${reportQuery.data?.summary.totalRows ?? 0} report rows`}
      />
    </div>

    <div class="grid gap-6 xl:grid-cols-[380px_1fr]">
      <div class="space-y-6">
        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Rule Builder</Card.Title>
            <Card.Description>Demo engine supports Sophos endpoint counts.</Card.Description>
          </Card.Header>
          <Card.Content class="space-y-4">
            <div class="space-y-2">
              <Label for="rule-name">Name</Label>
              <Input id="rule-name" bind:value={name} />
            </div>

            <div class="space-y-2">
              <Label for="rule-site">Site scope</Label>
              <select
                id="rule-site"
                class="h-9 w-full rounded-md border bg-background px-3 text-sm"
                bind:value={siteId}
              >
                <option value="">Any site matched by PSA row</option>
                {#each sitesQuery.data ?? [] as site}
                  <option value={site.id}>{site.name}</option>
                {/each}
              </select>
            </div>

            <div class="space-y-2">
              <Label for="psa-match">PSA item name contains</Label>
              <Input id="psa-match" bind:value={itemNameContains} />
            </div>

            <div class="space-y-2">
              <Label for="endpoint-type">Sophos endpoint type</Label>
              <select
                id="endpoint-type"
                class="h-9 w-full rounded-md border bg-background px-3 text-sm"
                bind:value={endpointType}
              >
                <option value="all">All active endpoints</option>
                <option value="computer">Computers</option>
                <option value="server">Servers</option>
              </select>
            </div>

            <label class="flex items-center gap-2 text-sm">
              <input type="checkbox" bind:checked={enabled} />
              Enabled
            </label>

            <div class="rounded-md border bg-muted/30 p-3 text-sm">
              <div class="mb-2 font-medium">Preview</div>
              {#if previewQuery.isLoading}
                <Loader />
              {:else if previewQuery.data}
                <div class="grid grid-cols-3 gap-2 text-center">
                  <div>
                    <div class="text-xs text-muted-foreground">Billed</div>
                    <div class="text-lg font-semibold">{previewQuery.data.billedQuantity}</div>
                  </div>
                  <div>
                    <div class="text-xs text-muted-foreground">Actual</div>
                    <div class="text-lg font-semibold">{previewQuery.data.actualQuantity}</div>
                  </div>
                  <div>
                    <div class="text-xs text-muted-foreground">Diff</div>
                    <div class="text-lg font-semibold">{previewQuery.data.diffQuantity}</div>
                  </div>
                </div>
                <div class="mt-2 text-xs text-muted-foreground">
                  Matched PSA row: {previewQuery.data.matchedItem?.itemName ?? 'none'}
                </div>
              {/if}
            </div>

            <Button class="w-full gap-2" disabled={saveRule.isPending} onclick={() => saveRule.mutate()}>
              <Plus class="size-4" />
              Save rule
            </Button>
          </Card.Content>
        </Card.Root>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Saved Rules</Card.Title>
          </Card.Header>
          <Card.Content class="space-y-2">
            {#if rulesQuery.data?.length}
              {#each rulesQuery.data as rule}
                <div class="flex items-start justify-between gap-3 rounded-md border p-3">
                  <div class="min-w-0">
                    <div class="truncate text-sm font-medium">{rule.name}</div>
                    <div class="text-xs text-muted-foreground">
                      {rule.vendorProvider} / {rule.vendorFacet}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="icon"
                    disabled={deleteRule.isPending}
                    onclick={() => deleteRule.mutate(rule.id)}
                  >
                    <Trash2 class="size-4" />
                  </Button>
                </div>
              {/each}
            {:else}
              <div class="py-4 text-center text-sm text-muted-foreground">No rules saved.</div>
            {/if}
          </Card.Content>
        </Card.Root>
      </div>

      <Card.Root class="rounded-lg">
        <Card.Header>
          <Card.Title>Current Reconciliation</Card.Title>
          <Card.Description>Calculated on demand from saved rules and current inventory.</Card.Description>
        </Card.Header>
        <Card.Content>
          {#if reportQuery.isLoading}
            <Loader />
          {:else if reportQuery.data?.rows.length}
            <div class="overflow-auto rounded-md border">
              <Table.Root>
                <Table.Header>
                  <Table.Row>
                    <Table.Head>Customer</Table.Head>
                    <Table.Head>PSA Item</Table.Head>
                    <Table.Head>Rule</Table.Head>
                    <Table.Head class="text-right">Billed</Table.Head>
                    <Table.Head class="text-right">Actual</Table.Head>
                    <Table.Head class="text-right">Diff</Table.Head>
                    <Table.Head class="text-right">MRR</Table.Head>
                    <Table.Head>Status</Table.Head>
                  </Table.Row>
                </Table.Header>
                <Table.Body>
                  {#each reportQuery.data.rows as row}
                    <Table.Row>
                      <Table.Cell class="font-medium">{row.siteName}</Table.Cell>
                      <Table.Cell>{row.psaItemName}</Table.Cell>
                      <Table.Cell>{row.ruleName ?? 'No rule'}</Table.Cell>
                      <Table.Cell class="text-right">{row.billedQuantity}</Table.Cell>
                      <Table.Cell class="text-right">{row.actualQuantity}</Table.Cell>
                      <Table.Cell class="text-right">{row.diffQuantity}</Table.Cell>
                      <Table.Cell class="text-right">{money(row.monthlyDelta)}</Table.Cell>
                      <Table.Cell>
                        <Badge variant={statusVariant(row.status)}>{row.status}</Badge>
                      </Table.Cell>
                    </Table.Row>
                  {/each}
                </Table.Body>
              </Table.Root>
            </div>
          {:else}
            <div class="py-10 text-center text-sm text-muted-foreground">
              Seed demo PSA rows or ingest PSA billing data, then save a rule.
            </div>
          {/if}
        </Card.Content>
      </Card.Root>
    </div>
  </div>
</div>
