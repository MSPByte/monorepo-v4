<script lang="ts">
  import { getContext } from 'svelte';
  import { page } from '$app/state';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import EntityHeader from '$lib/components/domain/entity-header.svelte';
  import FindingSeverityBadge from '$lib/components/domain/finding-severity-badge.svelte';
  import FindingStatusBadge from '$lib/components/domain/finding-status-badge.svelte';
  import * as Card from '$lib/components/ui/card';
  import { formatRelativeDate, prettyText } from '$lib/utils/format';
  import FadeIn from '$lib/components/transition/fade-in.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const id = $derived(page.params.id ?? '');

  const findingQuery = createQuery(() => ({
    queryKey: ['findings.byId', id],
    queryFn: () => trpc.findings.byId.query({ id }),
  }));

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
              {#if source.href}
                <a
                  href={source.href}
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
