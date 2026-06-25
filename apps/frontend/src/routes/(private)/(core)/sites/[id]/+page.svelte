<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';

  import SectionPanel from './_components/section-panel.svelte';
  import FactRow from './_components/fact-row.svelte';
  import MetricRow from './_components/metric-row.svelte';
  import FlagPill from './_components/flag-pill.svelte';
  import HealthMeter from './_components/health-meter.svelte';
  import TribalNote from './_components/tribal-note.svelte';
  import ContactRow from './_components/contact-row.svelte';
  import Legend from './_components/legend.svelte';
  import SourceGlyph from './_components/source-glyph.svelte';
  import FactEditor from './_components/fact-editor.svelte';
  import StackEditor from './_components/stack-editor.svelte';
  import NoteEditor from './_components/note-editor.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { useSiteContext } from './_components/site-context';
  import type { ProfileFact, ProfileNote, StackEntry } from './_profile/client-profile.types';

  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
  import Plus from '@lucide/svelte/icons/plus';
  import Separator from '$lib/components/ui/separator/separator.svelte';

  const ctx = useSiteContext();
  const profile = $derived(ctx.profile!);
  const site = $derived(ctx.site!);

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const canWriteSites = $derived(authStore.isAllowed('Sites.Write'));
  const canDeleteSites = $derived(authStore.isAllowed('Sites.Delete'));

  const parentQuery = createQuery(() => ({
    queryKey: ['sites.byId', site?.parentSiteId],
    queryFn: () => trpc.sites.byId.query({ id: site!.parentSiteId! }),
    enabled: !!site?.parentSiteId,
  }));

  const catalogQuery = createQuery(() => ({
    queryKey: ['siteProfile.catalog'],
    queryFn: () => trpc.siteProfile.catalog.query(),
  }));

  const catalogFieldByKey = $derived.by(() => {
    const map = new Map<
      string,
      {
        key: string;
        label: string;
        type: 'string' | 'number' | 'boolean';
        valueMode: 'single' | 'multiple';
        values: string[] | null;
      }
    >();
    for (const f of catalogQuery.data?.fields ?? []) {
      map.set(f.key, {
        key: f.key,
        label: f.label,
        type: f.type,
        valueMode: f.valueMode ?? 'single',
        values: f.values ?? null,
      });
    }
    return map;
  });

  function providerName(id: string) {
    return INTEGRATIONS[id as ProviderId]?.name ?? id;
  }

  function hasFactValue(fact: ProfileFact) {
    if (fact.applicable === 'not_applicable') return true;
    if (fact.applicable === 'unknown') return false;
    if (fact.value === null || fact.value === undefined || fact.value === '') return false;
    if (Array.isArray(fact.value) && fact.value.length === 0) return false;
    return true;
  }

  function hasStackValue(entry: StackEntry) {
    return (
      entry.status !== 'unknown' ||
      !!entry.vendor ||
      !!entry.product ||
      !!entry.notes ||
      Object.keys(entry.metadata ?? {}).length > 0
    );
  }

  const executiveFacts = $derived(
    profile.facts.filter((f) => f.category === 'executive' && hasFactValue(f))
  );
  const hiddenExecutiveFacts = $derived(
    profile.facts.filter((f) => f.category === 'executive' && !hasFactValue(f))
  );
  const contextFacts = $derived(
    profile.facts.filter((f) => f.category === 'context' && hasFactValue(f))
  );
  const hiddenContextFacts = $derived(
    profile.facts.filter((f) => f.category === 'context' && !hasFactValue(f))
  );
  const visibleStack = $derived(profile.stack.filter(hasStackValue));
  const hiddenStack = $derived(profile.stack.filter((entry) => !hasStackValue(entry)));
  const specialNotes = $derived(profile.notes.filter((n) => n.type === 'special'));
  const tribalNotes = $derived(profile.notes.filter((n) => n.type === 'tribal'));

  function factLabel(fact: ProfileFact) {
    return fact.label || fact.key;
  }

  function stackDisplay(entry: StackEntry): string {
    if (entry.status === 'not_used') return 'Not used';
    const parts = [entry.vendor, entry.product].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    if (entry.status === 'planned') return 'Planned';
    if (entry.status === 'unknown') return 'Unknown';
    return relationshipLabel(entry);
  }

  function stackTone(entry: StackEntry): string {
    if (entry.status === 'msp_managed') return 'text-foreground';
    if (entry.status === 'client_managed' || entry.status === 'vendor_managed')
      return 'text-foreground/80';
    if (entry.status === 'planned') return 'text-foreground/70 italic';
    if (entry.status === 'not_used') return 'text-muted-foreground/70 italic';
    return 'text-muted-foreground/60';
  }

  function relationshipLabel(entry: StackEntry): string {
    const labels: Record<StackEntry['status'], string> = {
      msp_managed: 'Managed by us',
      client_managed: 'Managed by client',
      vendor_managed: 'Managed by vendor',
      not_used: 'Not used',
      planned: 'Planned',
      unknown: 'Unknown',
    };
    return labels[entry.status];
  }

  function stackHighlights(entry: StackEntry) {
    return Object.entries(entry.metadata ?? {})
      .filter(([, value]) => value)
      .slice(0, 3);
  }

  let factOpen = $state(false);
  let factTarget = $state<ProfileFact | null>(null);
  let factInitialEditing = $state(false);
  function openFactEditor(fact: ProfileFact, edit = false) {
    factTarget = fact;
    factInitialEditing = edit && canWriteSites;
    factOpen = true;
  }

  let stackOpen = $state(false);
  let stackTarget = $state<StackEntry | null>(null);
  let stackInitialEditing = $state(false);
  function openStackEditor(entry: StackEntry, edit = false) {
    stackTarget = entry;
    stackInitialEditing = edit && canWriteSites;
    stackOpen = true;
  }

  type AddMode = 'executive' | 'context' | 'stack';
  let addOpen = $state(false);
  let addMode = $state<AddMode>('executive');
  let addSelection = $state('');

  const addOptions = $derived.by(() => {
    const rows =
      addMode === 'executive'
        ? hiddenExecutiveFacts.map((fact) => ({ value: fact.key, label: factLabel(fact) }))
        : addMode === 'context'
          ? hiddenContextFacts.map((fact) => ({ value: fact.key, label: factLabel(fact) }))
          : hiddenStack.map((entry) => ({ value: entry.categoryKey, label: entry.categoryLabel }));
    return rows.sort((a, b) => a.label.localeCompare(b.label));
  });

  function openAddDialog(mode: AddMode) {
    addMode = mode;
    addSelection = '';
    addOpen = true;
  }

  function addSelectedItem() {
    if (!addSelection) return;
    if (addMode === 'stack') {
      const entry = hiddenStack.find((row) => row.categoryKey === addSelection);
      if (entry) openStackEditor(entry, true);
    } else {
      const fact = [...hiddenExecutiveFacts, ...hiddenContextFacts].find(
        (row) => row.key === addSelection
      );
      if (fact) openFactEditor(fact, true);
    }
    addOpen = false;
    addSelection = '';
  }

  let noteOpen = $state(false);
  let noteType = $state<'special' | 'tribal'>('special');
  let noteTarget = $state<ProfileNote | null>(null);
  function openNoteEditor(type: 'special' | 'tribal', note: ProfileNote | null) {
    noteType = type;
    noteTarget = note;
    noteOpen = true;
  }
</script>

<div class="mx-auto max-w-[1400px] space-y-4 p-4 lg:p-6">
  <div
    class="flex flex-wrap items-center justify-between gap-3 border-l-2 border-primary bg-card px-3 py-2"
  >
    <div class="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
      CLIENT INTELLIGENCE PROFILE
      <span class="ml-2 text-foreground/70">·</span>
      <span class="ml-2">documentation {profile.completeness.value}% complete</span>
      <span class="ml-1 text-foreground/40">
        ({profile.completeness.completeCount}/{profile.completeness.applicableCount})
      </span>
    </div>
    <Legend />
  </div>

  <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
    <div class="space-y-4">
      <SectionPanel code="01" title="EXECUTIVE">
        {#snippet aside()}
          {#if hiddenExecutiveFacts.length && canWriteSites}
            <button
              type="button"
              class="inline-flex size-5 items-center justify-center border border-border bg-background text-foreground hover:border-primary hover:text-primary"
              aria-label="Add executive field"
              title="Add field"
              onclick={() => openAddDialog('executive')}
            >
              <Plus class="size-3.5" />
            </button>
          {/if}
        {/snippet}
        {#if executiveFacts.length}
          <dl>
            {#each executiveFacts as fact (fact.key)}
              <button
                type="button"
                class="block w-full text-left hover:bg-foreground/3"
                onclick={() => openFactEditor(fact)}
              >
                <FactRow label={factLabel(fact)} {fact} />
              </button>
            {/each}
          </dl>
        {:else}
          <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            no facts recorded
          </p>
        {/if}
      </SectionPanel>

      <SectionPanel code="02" title="TECHNOLOGY STACK">
        {#snippet aside()}
          {#if hiddenStack.length && canWriteSites}
            <button
              type="button"
              class="inline-flex size-5 items-center justify-center border border-border bg-background text-foreground hover:border-primary hover:text-primary"
              aria-label="Add stack item"
              title="Add stack item"
              onclick={() => openAddDialog('stack')}
            >
              <Plus class="size-3.5" />
            </button>
          {/if}
        {/snippet}
        {#if visibleStack.length}
          <dl>
            {#each visibleStack as entry (entry.categoryKey)}
              <button
                type="button"
                class="grid w-full grid-cols-[108px_minmax(0,1fr)] items-center gap-3 border-b border-border/50 py-[7px] text-left last:border-b-0 hover:bg-foreground/3 lg:grid-cols-[108px_minmax(0,1fr)_auto]"
                onclick={() => openStackEditor(entry)}
              >
                <dt
                  class="font-mono text-[10px] uppercase leading-tight tracking-wider text-muted-foreground"
                >
                  {entry.categoryLabel}
                  {#if entry.required}
                    <span class="ml-1 text-warning">*</span>
                  {/if}
                </dt>
                <dd class="min-w-0 text-sm">
                  <div class="flex min-w-0 items-center gap-2">
                    {#if entry.status === 'unknown'}
                      <span class="size-2"></span>
                    {:else}
                      <SourceGlyph
                        source={entry.source === 'generated' ? 'generated' : 'user_options'}
                      />
                    {/if}
                    <span class={`truncate ${stackTone(entry)}`}>{stackDisplay(entry)}</span>
                    {#if entry.status === 'client_managed' || entry.status === 'vendor_managed'}
                      <span
                        class="ml-1 rounded-[3px] border border-border px-1 py-px font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                      >
                        {entry.status === 'client_managed' ? 'client' : 'vendor'}
                      </span>
                    {/if}
                  </div>
                  {#if entry.notes || stackHighlights(entry).length}
                    <div
                      class="mt-1 flex min-w-0 flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground"
                    >
                      {#each stackHighlights(entry) as [key, value] (key)}
                        <span class="max-w-full truncate">
                          <span class="font-mono uppercase tracking-wider text-muted-foreground/70"
                            >{key.replace(/_/g, ' ')}</span
                          >
                          {value}
                        </span>
                      {/each}
                      {#if entry.notes}
                        <span class="truncate italic">{entry.notes}</span>
                      {/if}
                    </div>
                  {/if}
                </dd>
                <dd
                  class="whitespace-nowrap text-right font-mono text-[10px] text-muted-foreground/60"
                >
                  <span class="hidden lg:inline">{relationshipLabel(entry)}</span>
                </dd>
              </button>
            {/each}
          </dl>
        {:else}
          <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            no stack categories defined
          </p>
        {/if}
      </SectionPanel>

      <SectionPanel code="03" title="INFRASTRUCTURE METRICS">
        <div class="grid grid-cols-1 gap-x-6 md:grid-cols-2">
          <dl>
            {#each profile.metrics.slice(0, Math.ceil(profile.metrics.length / 2)) as metric (metric.key)}
              <MetricRow {metric} />
            {/each}
          </dl>
          <dl>
            {#each profile.metrics.slice(Math.ceil(profile.metrics.length / 2)) as metric (metric.key)}
              <MetricRow {metric} />
            {/each}
          </dl>
        </div>
      </SectionPanel>

      <SectionPanel code="04" title="BUSINESS CONTEXT">
        {#snippet aside()}
          {#if hiddenContextFacts.length && canWriteSites}
            <button
              type="button"
              class="inline-flex size-5 items-center justify-center border border-border bg-background text-foreground hover:border-primary hover:text-primary"
              aria-label="Add context field"
              title="Add field"
              onclick={() => openAddDialog('context')}
            >
              <Plus class="size-3.5" />
            </button>
          {/if}
        {/snippet}
        {#if contextFacts.length}
          <dl>
            {#each contextFacts as fact (fact.key)}
              <button
                type="button"
                class="block w-full text-left hover:bg-foreground/3"
                onclick={() => openFactEditor(fact)}
              >
                <FactRow label={factLabel(fact)} {fact} />
              </button>
            {/each}
          </dl>
        {:else}
          <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            no facts recorded
          </p>
        {/if}
      </SectionPanel>
    </div>

    <aside class="space-y-4">
      <SectionPanel code="H" title="DOCUMENTATION">
        <HealthMeter
          label="Completeness"
          score={profile.completeness.value}
          detail={`${profile.completeness.completeCount} of ${profile.completeness.applicableCount} applicable facts`}
        />
      </SectionPanel>

      <SectionPanel code="!" title="SPECIAL HANDLING">
        {#snippet aside()}
          {#if canWriteSites}
            <button
              class="inline-flex items-center gap-1 hover:text-foreground"
              onclick={() => openNoteEditor('special', null)}
            >
              <Plus class="size-3" /> Note
            </button>
          {/if}
        {/snippet}
        {#if specialNotes.length}
          <div class="space-y-2">
            {#each specialNotes as note (note.id)}
              <button
                type="button"
                class="block w-full text-left"
                onclick={() => openNoteEditor('special', note)}
              >
                <FlagPill {note} />
              </button>
            {/each}
          </div>
        {:else}
          <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            No special handling
          </p>
        {/if}
      </SectionPanel>

      <SectionPanel code="~" title="TRIBAL KNOWLEDGE">
        {#snippet aside()}
          {#if canWriteSites}
            <button
              class="inline-flex items-center gap-1 hover:text-foreground"
              onclick={() => openNoteEditor('tribal', null)}
            >
              <Plus class="size-3" /> Note
            </button>
          {/if}
        {/snippet}
        {#if tribalNotes.length}
          <div class="space-y-2">
            {#each tribalNotes as note (note.id)}
              <button
                type="button"
                class="block w-full text-left"
                onclick={() => openNoteEditor('tribal', note)}
              >
                <TribalNote {note} />
              </button>
            {/each}
          </div>
        {:else}
          <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            No tribal notes
          </p>
        {/if}
      </SectionPanel>

      <SectionPanel code="@" title="KEY CONTACTS">
        {#if profile.contacts.length}
          <dl>
            {#each profile.contacts as contact, i (`${contact.role}-${i}`)}
              <ContactRow {contact} />
            {/each}
          </dl>
        {:else}
          <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            No contacts on file
          </p>
        {/if}
      </SectionPanel>

      <SectionPanel code="↳" title="HIERARCHY">
        <div class="space-y-2 text-sm">
          {#if site.parentSiteId}
            <div class="flex items-center gap-2 border-b border-border/40 pb-2">
              <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >PARENT</span
              >
              <a
                href={`/sites/${site.parentSiteId}`}
                class="ml-auto inline-flex items-center gap-1 text-sm text-primary hover:underline"
              >
                {parentQuery.data?.name ?? 'Loading…'}
                <ArrowUpRight class="size-3" />
              </a>
            </div>
          {:else}
            <div class="flex items-center justify-between">
              <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
                >PARENT</span
              >
              <span class="font-mono text-xs text-muted-foreground/60">— top-level —</span>
            </div>
          {/if}
        </div>
      </SectionPanel>

      <SectionPanel code="≡" title="INTEGRATIONS">
        {#snippet aside()}
          {profile.integrations.length} linked
        {/snippet}
        {#if profile.integrations.length}
          <div class="space-y-1">
            {#each profile.integrations as link (link.id)}
              <div
                class="flex items-baseline justify-between gap-2 border-b border-border/40 py-1.5 text-sm last:border-b-0"
              >
                <div class="flex min-w-0 items-baseline gap-2">
                  <span
                    class={`size-1.5 shrink-0 translate-y-px rounded-full ${
                      link.status === 'active'
                        ? 'bg-primary'
                        : link.status === 'error'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground'
                    }`}
                  ></span>
                  <span class="truncate">{link.name ?? providerName(link.integrationId)}</span>
                </div>
                <span class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  {providerName(link.integrationId)}
                </span>
              </div>
            {/each}
          </div>
        {:else}
          <p class="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/70">
            no integrations linked
          </p>
        {/if}
      </SectionPanel>
    </aside>
  </div>
</div>

{#if factTarget}
  <FactEditor
    siteId={site.id}
    fact={factTarget}
    field={catalogFieldByKey.get(factTarget.key) ?? null}
    canWrite={canWriteSites}
    canDelete={canDeleteSites}
    initialEditing={factInitialEditing}
    bind:open={factOpen}
  />
{/if}

{#if stackTarget}
  <StackEditor
    siteId={site.id}
    entry={stackTarget}
    canWrite={canWriteSites}
    canDelete={canDeleteSites}
    initialEditing={stackInitialEditing}
    bind:open={stackOpen}
  />
{/if}

<NoteEditor
  siteId={site.id}
  type={noteType}
  note={noteTarget}
  canWrite={canWriteSites}
  canDelete={canDeleteSites}
  bind:open={noteOpen}
/>

<Dialog.Root bind:open={addOpen}>
  <Dialog.Content class="sm:max-w-[420px]">
    <Dialog.Header>
      <Dialog.Title>
        Add {addMode === 'stack' ? 'stack item' : 'field'}
      </Dialog.Title>
      <Dialog.Description>
        Choose a hidden {addMode === 'stack' ? 'stack category' : 'profile field'} to add to this panel.
      </Dialog.Description>
    </Dialog.Header>
    <Separator />
    <div class="grid gap-2 p-4">
      <SingleSelect
        options={addOptions}
        bind:selected={addSelection}
        placeholder={addMode === 'stack' ? 'Select stack item...' : 'Select field...'}
        searchPlaceholder="Search..."
      />
    </div>

    <Dialog.Footer>
      <button
        type="button"
        class="rounded-sm px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        onclick={() => (addOpen = false)}
      >
        Cancel
      </button>
      <button
        type="button"
        class="rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
        disabled={!addSelection}
        onclick={addSelectedItem}
      >
        Add
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
