<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import { getLocalTimeZone, parseDate, today, type CalendarDate } from '@internationalized/date';
  import { toast } from 'svelte-sonner';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';

  import SectionPanel from '$lib/components/panel/section-panel.svelte';
  import MetaRow from '$lib/components/panel/meta-row.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { getPolicyTableShape } from '@mspbyte/shared';
  import { serializeFilters } from '$lib/components/data-table';
  import DatePicker from '$lib/components/date-picker.svelte';
  import { Button } from '$lib/components/ui/button';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';

  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import FindingBriefing from './_components/finding-briefing.svelte';

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
    class="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
  >
    <div class="min-w-0">
      <div class="truncate">{item.title}</div>
      <div class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground">
        {item.resourceName} · {item.siteName}
      </div>
    </div>
    <div class="flex shrink-0 items-center gap-1.5">
      <FindingSeverityBadge severity={item.severity} />
      <ArrowUpRight class="size-3 text-muted-foreground" />
    </div>
  </a>
{/snippet}

{#if findingQuery.data}
  {@const finding = findingQuery.data}
  <FadeIn class="flex flex-col size-full">
    <FindingBriefing
      id={finding.id}
      title={finding.title}
      severity={finding.severity}
      status={finding.status}
      siteId={finding.siteId}
      siteName={finding.siteName}
      policyName={finding.policyName}
      resourceName={finding.resourceName}
      linkName={finding.linkName}
      firstSeenAt={finding.firstSeenAt}
      lastSeenAt={finding.lastSeenAt}
      evidenceSummary={finding.evidenceSummary}
    />

    <div class="flex size-full items-center justify-center overflow-auto p-4">
      <div class="flex flex-col h-full mx-auto max-w-[1400px] gap-4">
        <!-- Top legend strip -->
        <div
          class="flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-card px-3 py-2"
        >
          <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            FINDING INTELLIGENCE
            <span class="ml-2 text-foreground/70">·</span>
            <span class="ml-2">last seen {formatRelativeDate(finding.lastSeenAt)}</span>
          </div>
          <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            {finding.dataSources.length} data {finding.dataSources.length === 1
              ? 'source'
              : 'sources'}
            · {finding.relatedBySite.length + finding.relatedByPolicy.length} related
          </div>
        </div>

        <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
          <!-- LEFT COLUMN -->
          <div class="space-y-4">
            <SectionPanel code="01" title="EVIDENCE">
              {#snippet aside()}
                {finding.evidenceSummary ? 'detail' : 'no detail'}
              {/snippet}
              <div class="space-y-4 text-sm">
                {#each buildEvidence(finding.evidence) as item}
                  <div>
                    <div
                      class="mb-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      {item.label}
                    </div>
                    {#if item.kind === 'scalar'}
                      <div
                        class="wrap-break-word font-mono text-[13px] tabular-nums text-foreground"
                      >
                        {item.value}
                      </div>
                    {:else if item.kind === 'conditions'}
                      <div class="flex flex-wrap gap-1.5">
                        {#each item.conditions as condition}
                          <code
                            class="rounded-[3px] border border-border/70 bg-muted/40 px-2 py-0.5 font-mono text-[11.5px] text-foreground"
                            >{condition}</code
                          >
                        {/each}
                      </div>
                    {:else}
                      <dl
                        class="grid gap-x-6 gap-y-2 border border-border/50 bg-muted/20 p-3 sm:grid-cols-2"
                      >
                        {#each item.entries as entry}
                          <div class="min-w-0">
                            <dt
                              class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                            >
                              {entry.label}
                            </dt>
                            <dd class="wrap-break-word text-sm">{entry.value}</dd>
                          </div>
                        {/each}
                      </dl>
                    {/if}
                  </div>
                {:else}
                  <p
                    class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70"
                  >
                    {finding.evidenceSummary || 'no evidence captured'}
                  </p>
                {/each}
              </div>
            </SectionPanel>

            <SectionPanel code="02" title="DATA SOURCES">
              {#snippet aside()}
                {finding.dataSources.length} record{finding.dataSources.length === 1 ? '' : 's'}
              {/snippet}
              <div class="space-y-1">
                {#each finding.dataSources as source}
                  {@const href = dataSourceHref(source)}
                  {#if href}
                    <a
                      {href}
                      class="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
                    >
                      <div class="flex min-w-0 items-baseline gap-2">
                        <span
                          class={`size-1.5 shrink-0 translate-y-px rounded-full ${source.kind === 'canonical' ? 'bg-primary' : 'bg-muted-foreground'}`}
                        ></span>
                        <span class="truncate">{source.name}</span>
                      </div>
                      <span
                        class="flex shrink-0 items-center gap-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                      >
                        {source.label}
                        <ArrowUpRight class="size-3" />
                      </span>
                    </a>
                  {:else}
                    <div
                      class="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm last:border-b-0"
                    >
                      <div class="flex min-w-0 items-baseline gap-2">
                        <span
                          class={`size-1.5 shrink-0 translate-y-px rounded-full ${source.kind === 'canonical' ? 'bg-primary' : 'bg-muted-foreground'}`}
                        ></span>
                        <span class="truncate">{source.name}</span>
                      </div>
                      <span
                        class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                      >
                        {source.label}{source.provider ? ` · ${source.provider}` : ''}
                      </span>
                    </div>
                  {/if}
                {/each}
              </div>
            </SectionPanel>

            <SectionPanel code="03" title="RECOMMENDATION">
              <p class="text-sm leading-relaxed text-foreground/90">{finding.recommendation}</p>
            </SectionPanel>
          </div>

          <!-- RIGHT COLUMN -->
          <aside class="flex flex-col size-full space-y-4">
            <SectionPanel code="@" title="CONTEXT">
              <dl>
                <MetaRow
                  label="Site"
                  value={finding.siteName}
                  href={finding.siteId ? `/sites/${finding.siteId}` : undefined}
                />
                <MetaRow label="Link" value={finding.linkName} />
                <MetaRow
                  label="Policy"
                  value={finding.policyName}
                  href={`/policies/${finding.policyId}`}
                />
                <MetaRow label="Resource" value={finding.resourceName} />
                <MetaRow label="Integration" value={finding.linkName} />
                <MetaRow label="First Seen" value={formatRelativeDate(finding.firstSeenAt)} mono />
                <MetaRow label="Last Seen" value={formatRelativeDate(finding.lastSeenAt)} mono />
              </dl>
            </SectionPanel>

            <SectionPanel code="!" title="LIFECYCLE">
              {#snippet aside()}
                {finding.status === 'suppressed' ? 'suppressed' : 'active'}
              {/snippet}
              <div class="space-y-3 text-sm">
                {#if finding.status === 'suppressed'}
                  <div class="border border-border/50 bg-muted/20 p-3">
                    <div
                      class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      Reason
                    </div>
                    <div class="mt-1 wrap-break-word">{finding.suppressionReason ?? '—'}</div>
                    <dl class="mt-3">
                      <MetaRow label="Suppressed By" value={finding.suppressedByLabel} />
                      <MetaRow
                        label="Suppressed"
                        value={finding.suppressedAt
                          ? formatRelativeDate(finding.suppressedAt)
                          : null}
                        mono
                      />
                      <MetaRow
                        label="Until"
                        value={finding.suppressedUntil
                          ? formatRelativeDate(finding.suppressedUntil)
                          : 'Indefinite'}
                        mono
                      />
                    </dl>
                  </div>
                  <Button variant="outline" disabled={lifecycleBusy} onclick={unsuppressFinding}>
                    Return to active tracking
                  </Button>
                {:else}
                  <div class="space-y-1.5">
                    <label
                      class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
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
                  <div class="space-y-1.5">
                    <span
                      class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                    >
                      Quick select
                    </span>
                    <div class="flex flex-wrap gap-1">
                      {#each suppressionPresets as preset}
                        <button
                          type="button"
                          onclick={() => applyPreset(preset.days)}
                          class={[
                            'inline-flex items-center rounded-[3px] border px-2 py-0.5 font-mono text-[11px] tracking-wider transition-colors',
                            isActivePreset(preset.days)
                              ? 'border-primary bg-primary text-primary-foreground'
                              : 'border-border bg-muted/30 text-muted-foreground hover:bg-muted hover:text-foreground',
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
                  <p class="font-mono text-[11px] uppercase tracking-wider text-destructive">
                    {lifecycleError}
                  </p>
                {/if}
              </div>
            </SectionPanel>

            {#if finding.relatedByPolicy.length}
              <SectionPanel code="≡" title="SIMILAR · POLICY">
                {#snippet aside()}
                  {finding.relatedByPolicy.length} open
                {/snippet}
                <div>
                  {#each finding.relatedByPolicy as item}
                    {@render relatedRow(item)}
                  {/each}
                </div>
              </SectionPanel>
            {/if}

            {#if finding.relatedBySite.length}
              <SectionPanel code="↳" title="SAME SITE">
                {#snippet aside()}
                  {finding.relatedBySite.length} open
                {/snippet}
                <div>
                  {#each finding.relatedBySite as item}
                    {@render relatedRow(item)}
                  {/each}
                </div>
              </SectionPanel>
            {/if}
          </aside>
        </div>
      </div>
    </div>
  </FadeIn>
{:else}
  <Loader />
{/if}
