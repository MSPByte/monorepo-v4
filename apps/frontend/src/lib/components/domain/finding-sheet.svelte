<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { getLocalTimeZone, parseDate, today, type CalendarDate } from '@internationalized/date';
  import { toast } from 'svelte-sonner';
  import ExternalLinkIcon from '@lucide/svelte/icons/external-link';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import DatePicker from '$lib/components/date-picker.svelte';
  import { Button } from '$lib/components/ui/button';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { formatRelativeDate } from '$lib/utils/format';
  import FindingStatusBadge from './finding-status-badge.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  let {
    findingId,
    onclose,
    onchange,
  }: {
    findingId: string | null;
    onclose: () => void;
    onchange?: () => void;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
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

  const findingQuery = createQuery(() => ({
    queryKey: ['findings.byId.sheet', findingId],
    queryFn: () => trpc.findings.byId.query({ id: findingId! }),
    enabled: !!findingId,
  }));

  $effect(() => {
    const finding = findingQuery.data;
    if (!finding) return;
    suppressionReason = finding.suppressionReason ?? '';
    suppressDate = finding.suppressedUntil
      ? calendarDateFromIso(finding.suppressedUntil)
      : undefined;
    lifecycleError = null;
  });

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

  async function refreshFinding() {
    await findingQuery.refetch();
    onchange?.();
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
      await refreshFinding();
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
      await refreshFinding();
      toast.success('Finding returned to active tracking');
    } catch (error) {
      lifecycleError = error instanceof Error ? error.message : 'Failed to unsuppress finding';
      toast.error(lifecycleError);
    } finally {
      lifecycleBusy = false;
    }
  }
</script>

{#snippet detailRow(label: string, value: string | null | undefined)}
  <div>
    <div class="text-xs text-muted-foreground">{label}</div>
    <div class="wrap-break-word text-sm">{value || '—'}</div>
  </div>
{/snippet}

<Sheet.Root
  open={!!findingId}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="flex w-120! max-w-120! flex-col p-0">
    {#if findingQuery.isPending}
      <Loader />
    {:else if findingQuery.data}
      {@const finding = findingQuery.data}
      <Sheet.Header class="border-b p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <Sheet.Title class="leading-snug flex gap-1">
              <FindingStatusBadge status={finding.status} />
            </Sheet.Title>
            <Sheet.Description class="mt-1 flex flex-col flex-wrap gap-2">
              {finding.title}
              <div>
                <Button
                  variant="link"
                  size="sm"
                  href={`/findings/${finding.id}`}
                  target="_blank"
                  rel="noreferrer"
                  class="gap-1"
                >
                  <ExternalLinkIcon data-icon="inline-start" />
                  Open Finding
                </Button>
              </div>
            </Sheet.Description>
          </div>
        </div>
      </Sheet.Header>

      <div class="flex-1 space-y-5 overflow-y-auto p-4">
        <section class="space-y-3">
          <h3 class="text-sm font-medium">Summary</h3>
          <p class="text-sm text-muted-foreground">{finding.evidenceSummary}</p>
          <div class="grid gap-3 sm:grid-cols-2">
            {@render detailRow('Policy', finding.policyName)}
            {@render detailRow('Affected resource', finding.resourceName)}
            {@render detailRow('Site', finding.siteName)}
            {@render detailRow('Integration link', finding.linkName)}
            {@render detailRow('Last seen', formatRelativeDate(finding.lastSeenAt))}
          </div>
        </section>

        <section class="space-y-3">
          <h3 class="text-sm font-medium">Recommendation</h3>
          <p class="text-sm text-muted-foreground">{finding.recommendation}</p>
        </section>

        <section class="space-y-3 border-t pt-4">
          <div>
            <h3 class="text-sm font-medium">Suppression</h3>
            <p class="text-xs text-muted-foreground">
              Suppressed findings are removed from active tracking until restored or the optional
              date passes.
            </p>
          </div>

          {#if finding.status === 'suppressed'}
            <div class="rounded-md bg-muted p-3 text-sm">
              <div class="text-xs text-muted-foreground">Reason</div>
              <div class="mt-1 wrap-break-word">{finding.suppressionReason ?? '—'}</div>
              <div class="mt-3 grid gap-3 sm:grid-cols-2">
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
              <label class="text-xs font-medium text-muted-foreground" for="suppression-reason">
                Reason
              </label>
              <Textarea
                id="suppression-reason"
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
        </section>
      </div>
    {:else}
      <div class="p-4 text-sm text-muted-foreground">Finding not found.</div>
    {/if}
  </Sheet.Content>
</Sheet.Root>
