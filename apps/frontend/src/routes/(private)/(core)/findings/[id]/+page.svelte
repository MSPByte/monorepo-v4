<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { getLocalTimeZone, parseDate, today, type CalendarDate } from '@internationalized/date';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { getPolicyTableShape } from '@mspbyte/shared';
  import { serializeFilters } from '$lib/components/data-table';
  import DatePicker from '$lib/components/date-picker.svelte';
  import { Button } from '$lib/components/ui/button';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  type DataSource = NonNullable<typeof findingQuery.data>['dataSources'][number];

  // Deep-link a vendor data source to its UI table route, pre-filtered to the
  // single underlying record. Route + search field live in the shared shape config.
  function dataSourceHref(source: DataSource): string | null {
    if (source.href) return source.href;
    if (!source.table || !source.externalId) return null;
    const route = getPolicyTableShape(source.table)?.route;
    if (!route) return null;
    const filters = serializeFilters([
      { id: 'finding', field: route.searchField, operator: 'eq', value: source.externalId },
    ]);
    const params = new URLSearchParams({ filters });
    return `${route.path}?${params.toString()}`;
  }

  const findingQuery = createQuery(() => ({
    queryKey: ['findings.byId', id],
    queryFn: () => trpc.findings.byId.query({ id }),
  }));

  let suppressionReason = $state('');
  let suppressDate = $state<CalendarDate | undefined>(undefined);
  let lifecycleBusy = $state(false);
  let lifecycleError = $state<string | null>(null);

  const suppressionPresets = [
    { label: '1 week', days: 7 },
    { label: '2 weeks', days: 14 },
    { label: '1 month', days: 30 },
    { label: '3 months', days: 90 },
    { label: '6 months', days: 180 },
  ];

  const maxSuppressionDate = $derived(today(getLocalTimeZone()).add({ days: 180 }));

  $effect(() => {
    const finding = findingQuery.data;
    if (!finding) return;
    suppressionReason = finding.suppressionReason ?? '';
    suppressDate = finding.suppressedUntil
      ? calendarDateFromIso(finding.suppressedUntil)
      : undefined;
    lifecycleError = null;
  });

  type Related = NonNullable<typeof findingQuery.data>['relatedBySite'][number];

  const OP_LABELS: Record<string, string> = {
    eq: '=',
    ne: '≠',
    gt: '>',
    lt: '<',
    gte: '≥',
    lte: '≤',
    in: 'in',
    nin: 'not in',
    contains: 'contains',
    exists: 'exists',
  };

  function scalarText(value: unknown): string {
    if (value === null || value === undefined) return '—';
    if (Array.isArray(value)) return value.map(scalarText).join(', ');
    if (typeof value === 'object') return JSON.stringify(value);
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return String(value);
  }

  // Prettify identifier-like strings (e.g. "rowExpectation") but leave emails,
  // IDs, and free text untouched.
  function displayText(value: unknown): string {
    if (typeof value === 'string' && /^[a-z][a-zA-Z0-9]*$/.test(value)) return prettyText(value);
    return scalarText(value);
  }

  type EvidenceItem =
    | { label: string; kind: 'scalar'; value: string }
    | { label: string; kind: 'object'; entries: { label: string; value: string }[] }
    | { label: string; kind: 'conditions'; conditions: string[] };

  function isCondition(v: unknown): v is { op: string; field: string; value: unknown } {
    return !!v && typeof v === 'object' && 'field' in v && 'op' in v;
  }

  function buildEvidence(evidence: Record<string, unknown>): EvidenceItem[] {
    return Object.entries(evidence)
      .filter(([key]) => key !== 'summary')
      .map(([key, value]): EvidenceItem => {
        const label = prettyText(key);
        if (Array.isArray(value) && value.every(isCondition)) {
          return {
            label,
            kind: 'conditions',
            conditions: value.map(
              (c) => `${prettyText(c.field)} ${OP_LABELS[c.op] ?? c.op} ${scalarText(c.value)}`
            ),
          };
        }
        if (value && typeof value === 'object' && !Array.isArray(value)) {
          return {
            label,
            kind: 'object',
            entries: Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
              label: prettyText(k),
              value: scalarText(v),
            })),
          };
        }
        return { label, kind: 'scalar', value: displayText(value) };
      });
  }

  function calendarDateFromIso(value: string): CalendarDate | undefined {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return undefined;
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return parseDate(`${year}-${month}-${day}`);
  }

  function applyPreset(days: number) {
    suppressDate = today(getLocalTimeZone()).add({ days });
  }

  function isActivePreset(days: number): boolean {
    if (!suppressDate) return false;
    return suppressDate.toString() === today(getLocalTimeZone()).add({ days }).toString();
  }

  async function suppressFinding() {
    const finding = findingQuery.data;
    if (!finding) return;
    const reason = suppressionReason.trim();
    if (reason.length < 3) {
      lifecycleError = 'Enter a suppression reason.';
      return;
    }
    if (!suppressDate) {
      lifecycleError = 'Choose how long to suppress this finding.';
      return;
    }

    lifecycleBusy = true;
    lifecycleError = null;
    try {
      const suppressedUntil = suppressDate.toDate(getLocalTimeZone());
      if (suppressedUntil <= new Date()) {
        lifecycleError = 'Choose a future suppression date.';
        return;
      }
      await trpc.findings.suppress.mutate({
        id: finding.id,
        reason,
        suppressedUntil: suppressedUntil.toISOString(),
      });
      await findingQuery.refetch();
      toast.success('Finding suppressed');
    } catch (error) {
      lifecycleError = error instanceof Error ? error.message : 'Failed to suppress finding';
      toast.error(lifecycleError);
    } finally {
      lifecycleBusy = false;
    }
  }

  async function unsuppressFinding() {
    const finding = findingQuery.data;
    if (!finding) return;

    lifecycleBusy = true;
    lifecycleError = null;
    try {
      await trpc.findings.unsuppress.mutate({ id: finding.id });
      suppressionReason = '';
      suppressDate = undefined;
      await findingQuery.refetch();
      toast.success('Finding returned to active tracking');
    } catch (error) {
      lifecycleError = error instanceof Error ? error.message : 'Failed to unsuppress finding';
      toast.error(lifecycleError);
    } finally {
      lifecycleBusy = false;
    }
  }
</script>

{#snippet relatedRow(item: Related)}
  <a
    href={`/findings/${item.id}`}
    class="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 transition-colors hover:bg-accent"
  >
    <div class="min-w-0">
      <div class="truncate text-sm">{item.title}</div>
      <div class="truncate text-xs text-muted-foreground">
        {item.resourceName} · {item.siteName}
      </div>
    </div>
    <FindingSeverityBadge severity={item.severity} />
  </a>
{/snippet}

{#snippet detailRow(label: string, value: string | null | undefined)}
  <div>
    <div class="text-xs text-muted-foreground">{label}</div>
    <div class="wrap-break-word text-sm">{value || '—'}</div>
  </div>
{/snippet}

{#if findingQuery.data}
  {@const finding = findingQuery.data}
  <FadeIn class="size-full overflow-auto">
    <EntityHeader
      eyebrow="Finding"
      title={finding.title}
      subtitle={`${finding.resourceName} · ${finding.policyName}`}
      sources={finding.sources}
    />
    <div class="mx-auto grid max-w-7xl gap-6 p-6 lg:grid-cols-[1fr_360px]">
      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header>
            <div class="flex flex-wrap gap-2">
              <FindingSeverityBadge severity={finding.severity} />
              <FindingStatusBadge status={finding.status} />
            </div>
            <Card.Title>Finding summary</Card.Title>
            <Card.Description>{finding.evidenceSummary}</Card.Description>
          </Card.Header>
          <Card.Content class="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <div class="text-xs text-muted-foreground">Site</div>
              {#if finding.siteId}
                <a href={`/sites/${finding.siteId}`} class="hover:underline">{finding.siteName}</a>
              {:else}
                <div>{finding.siteName}</div>
              {/if}
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Integration link</div>
              <div>{finding.linkName}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Policy</div>
              <a href={`/policies/${finding.policyId}`} class="hover:underline"
                >{finding.policyName}</a
              >
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Affected resource</div>
              <div>{finding.resourceName}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">First seen</div>
              <div>{formatRelativeDate(finding.firstSeenAt)}</div>
            </div>
            <div>
              <div class="text-xs text-muted-foreground">Last seen</div>
              <div>{formatRelativeDate(finding.lastSeenAt)}</div>
            </div>
          </Card.Content>
        </Card.Root>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Data sources</Card.Title>
            <Card.Description
              >Underlying records this finding was evaluated against.</Card.Description
            >
          </Card.Header>
          <Card.Content class="space-y-2 text-sm">
            {#each finding.dataSources as source}
              {@const href = dataSourceHref(source)}
              {#if href}
                <a
                  {href}
                  class="flex items-center justify-between gap-3 rounded-md bg-muted px-3 py-2 transition-colors hover:bg-accent"
                >
                  <div class="min-w-0">
                    <div class="truncate">{source.name}</div>
                    <div class="text-xs text-muted-foreground">{source.label}</div>
                  </div>
                  <span class="text-xs text-muted-foreground">View →</span>
                </a>
              {:else}
                <div class="rounded-md bg-muted px-3 py-2">
                  <div class="truncate">{source.name}</div>
                  <div class="text-xs text-muted-foreground">
                    {source.label}{source.provider ? ` · ${source.provider}` : ''}
                  </div>
                </div>
              {/if}
            {/each}
          </Card.Content>
        </Card.Root>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Evidence</Card.Title>
          </Card.Header>
          <Card.Content class="space-y-4 text-sm">
            {#each buildEvidence(finding.evidence) as item}
              <div>
                <div class="mb-1 text-xs font-medium text-muted-foreground">{item.label}</div>
                {#if item.kind === 'scalar'}
                  <div class="break-words">{item.value}</div>
                {:else if item.kind === 'conditions'}
                  <div class="flex flex-wrap gap-2">
                    {#each item.conditions as condition}
                      <code class="rounded bg-muted px-2 py-1 text-xs">{condition}</code>
                    {/each}
                  </div>
                {:else}
                  <dl class="grid gap-x-6 gap-y-2 rounded-md bg-muted p-3 sm:grid-cols-2">
                    {#each item.entries as entry}
                      <div class="min-w-0">
                        <dt class="text-xs text-muted-foreground">{entry.label}</dt>
                        <dd class="break-words">{entry.value}</dd>
                      </div>
                    {/each}
                  </dl>
                {/if}
              </div>
            {:else}
              <p class="text-muted-foreground">{finding.evidenceSummary}</p>
            {/each}
          </Card.Content>
        </Card.Root>
      </div>

      <div class="space-y-4">
        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Recommendation</Card.Title>
          </Card.Header>
          <Card.Content class="text-sm text-muted-foreground">{finding.recommendation}</Card.Content
          >
        </Card.Root>

        <Card.Root class="rounded-lg">
          <Card.Header>
            <Card.Title>Suppression</Card.Title>
            <Card.Description>
              Suppressed findings are removed from active tracking until restored or the selected
              date passes.
            </Card.Description>
          </Card.Header>
          <Card.Content class="space-y-3 text-sm">
            {#if finding.status === 'suppressed'}
              <div class="rounded-md bg-muted p-3">
                <div class="text-xs text-muted-foreground">Reason</div>
                <div class="mt-1 wrap-break-word">{finding.suppressionReason ?? '—'}</div>
                <div class="mt-3 grid gap-3">
                  {@render detailRow('Suppressed by', finding.suppressedByLabel)}
                  {@render detailRow(
                    'Suppressed',
                    finding.suppressedAt ? formatRelativeDate(finding.suppressedAt) : null
                  )}
                  {@render detailRow(
                    'Suppressed until',
                    finding.suppressedUntil
                      ? formatRelativeDate(finding.suppressedUntil)
                      : 'Indefinite'
                  )}
                </div>
              </div>
              <Button variant="outline" disabled={lifecycleBusy} onclick={unsuppressFinding}>
                Return to active tracking
              </Button>
            {:else}
              <div class="space-y-2">
                <label
                  class="text-xs font-medium text-muted-foreground"
                  for="page-suppression-reason"
                >
                  Reason
                </label>
                <Textarea
                  id="page-suppression-reason"
                  bind:value={suppressionReason}
                  placeholder="Document why this finding should not be actively tracked."
                  rows={4}
                />
              </div>
              <div class="space-y-2">
                <span
                  class="px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground"
                >
                  Quick select
                </span>
                <div class="flex flex-wrap gap-1.5">
                  {#each suppressionPresets as preset}
                    <button
                      type="button"
                      onclick={() => applyPreset(preset.days)}
                      class={[
                        'inline-flex items-center rounded-full border px-3 py-1 text-xs font-medium transition-colors',
                        isActivePreset(preset.days)
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border bg-muted/40 text-muted-foreground hover:bg-muted hover:text-foreground',
                      ].join(' ')}
                    >
                      {preset.label}
                    </button>
                  {/each}
                </div>
              </div>
              <DatePicker
                title="Suppress Until"
                maxValue={maxSuppressionDate}
                bind:value={suppressDate}
              />
              <Button disabled={!suppressDate || lifecycleBusy} onclick={suppressFinding}>
                Suppress finding
              </Button>
            {/if}

            {#if lifecycleError}
              <p class="text-sm text-destructive">{lifecycleError}</p>
            {/if}
          </Card.Content>
        </Card.Root>

        {#if finding.relatedByPolicy.length}
          <Card.Root class="rounded-lg">
            <Card.Header>
              <Card.Title>Similar open findings</Card.Title>
              <Card.Description>Same policy ({finding.policyName}).</Card.Description>
            </Card.Header>
            <Card.Content class="space-y-2">
              {#each finding.relatedByPolicy as item}
                {@render relatedRow(item)}
              {/each}
            </Card.Content>
          </Card.Root>
        {/if}

        {#if finding.relatedBySite.length}
          <Card.Root class="rounded-lg">
            <Card.Header>
              <Card.Title>Other open findings at this site</Card.Title>
              <Card.Description>{finding.siteName}</Card.Description>
            </Card.Header>
            <Card.Content class="space-y-2">
              {#each finding.relatedBySite as item}
                {@render relatedRow(item)}
              {/each}
            </Card.Content>
          </Card.Root>
        {/if}
      </div>
    </div>
  </FadeIn>
{:else}
  <Loader />
{/if}
