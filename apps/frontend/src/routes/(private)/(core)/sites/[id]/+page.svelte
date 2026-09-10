<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';

  import SectionPanel from '../_components/site-panel.svelte';
  import FactRow from './_components/fact-row.svelte';
  import MetricRow from './_components/metric-row.svelte';
  import FlagPill from './_components/flag-pill.svelte';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Search, ListChecks, Pencil, ChevronRight, ShieldCheck } from '@lucide/svelte';
  import TribalNote from './_components/tribal-note.svelte';
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

  import Plus from '@lucide/svelte/icons/plus';
  import X from '@lucide/svelte/icons/x';
  import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';

  const ctx = useSiteContext();
  const profile = $derived(ctx.profile!);
  const site = $derived(ctx.site!);

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canWriteSites = $derived(authStore.isAllowed('Sites.Write'));
  const canDeleteSites = $derived(authStore.isAllowed('Sites.Delete'));

  const groupsQuery = createQuery(() => ({
    queryKey: ['siteGroups.forSite', site?.id],
    queryFn: () => trpc.siteGroups.forSite.query({ siteId: site!.id }),
    enabled: !!site?.id,
  }));

  const allGroupsQuery = createQuery(() => ({
    queryKey: ['siteGroups.list'],
    queryFn: () => trpc.siteGroups.list.query(),
  }));

  const memberGroupIds = $derived(new Set((groupsQuery.data ?? []).map((g) => g.id)));
  const availableGroupOptions = $derived(
    (allGroupsQuery.data ?? [])
      .filter((g) => !memberGroupIds.has(g.id))
      .map((g) => ({ value: g.id, label: g.name }))
  );

  let groupDialogOpen = $state(false);
  let groupDialogMode = $state<'add' | 'create'>('add');
  let selectedGroupId = $state('');
  let newGroupName = $state('');
  let newGroupDescription = $state('');
  let savingGroup = $state(false);

  async function refreshGroups() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['siteGroups.forSite', site.id] }),
      queryClient.invalidateQueries({ queryKey: ['siteGroups.list'] }),
    ]);
  }

  function openGroupDialog() {
    groupDialogMode = availableGroupOptions.length ? 'add' : 'create';
    selectedGroupId = '';
    newGroupName = '';
    newGroupDescription = '';
    groupDialogOpen = true;
  }

  async function saveGroupSelection() {
    if (!site) return;
    savingGroup = true;
    try {
      if (groupDialogMode === 'add') {
        if (!selectedGroupId) {
          toast.error('Select a group to add');
          return;
        }
        await trpc.siteGroups.addMember.mutate({
          siteId: site.id,
          siteGroupId: selectedGroupId,
        });
      } else {
        const name = newGroupName.trim();
        if (!name) {
          toast.error('Group name is required');
          return;
        }
        const created = await trpc.siteGroups.create.mutate({
          name,
          description: newGroupDescription.trim() || null,
        });
        await trpc.siteGroups.addMember.mutate({
          siteId: site.id,
          siteGroupId: created.id,
        });
      }
      await refreshGroups();
      groupDialogOpen = false;
      toast.success('Group membership updated');
    } catch (error) {
      showErrorToast(error, 'Failed to update groups.');
    } finally {
      savingGroup = false;
    }
  }

  async function removeGroup(groupId: string) {
    if (!site) return;
    try {
      await trpc.siteGroups.removeMember.mutate({
        siteId: site.id,
        siteGroupId: groupId,
      });
      await refreshGroups();
    } catch (error) {
      showErrorToast(error, 'Failed to remove group.');
    }
  }

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
        valueType: string | null;
        values: string[] | null;
      }
    >();
    for (const f of catalogQuery.data?.fields ?? []) {
      map.set(f.key, {
        key: f.key,
        label: f.label,
        type: f.type,
        valueMode: f.valueMode ?? 'single',
        valueType: f.valueType ?? null,
        values: f.values ?? null,
      });
    }
    return map;
  });

  function providerName(id: string) {
    return INTEGRATIONS[id as ProviderId]?.name ?? id;
  }

  function integrationHref(link: {
    id: string;
    integrationId: string;
    meta?: Record<string, unknown> | null;
  }) {
    const parentLinkId = (link.meta?.parentLinkId as string | undefined) ?? link.id;
    const params = new URLSearchParams({ linkId: parentLinkId });
    if (site?.id) params.set('siteId', site.id);
    return `/${link.integrationId}?${params.toString()}`;
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
  let fieldSearch = $state('');
  let fieldFilter = $state<'all' | 'missing'>('missing');
  const profileDetailCount = $derived(profile.facts.length + profile.stack.length);
  const missingCount = $derived(
    hiddenExecutiveFacts.length + hiddenContextFacts.length + hiddenStack.length
  );
  const fieldChoices = $derived.by(() => {
    const choices =
      addMode === 'stack'
        ? profile.stack.map((entry) => ({
            key: entry.categoryKey,
            label: entry.categoryLabel,
            missing: !hasStackValue(entry),
            detail: hasStackValue(entry) ? stackDisplay(entry) : 'Not documented',
            fact: null,
            entry,
          }))
        : profile.facts
            .filter((fact) => fact.category === addMode)
            .map((fact) => ({
              key: fact.key,
              label: factLabel(fact),
              missing: !hasFactValue(fact),
              detail: !hasFactValue(fact)
                ? 'Not documented'
                : fact.applicable === 'not_applicable'
                  ? 'Not applicable'
                  : Array.isArray(fact.value)
                    ? fact.value.join(', ')
                    : String(fact.value),
              fact,
              entry: null,
            }));
    return choices.sort(
      (a, b) => Number(b.missing) - Number(a.missing) || a.label.localeCompare(b.label)
    );
  });
  const visibleFieldChoices = $derived(
    fieldChoices.filter(
      (choice) =>
        (fieldFilter === 'all' || choice.missing) &&
        `${choice.label} ${choice.detail}`.toLowerCase().includes(fieldSearch.trim().toLowerCase())
    )
  );
  function openAddDialog(mode: AddMode, missingOnly = true) {
    addMode = mode;
    fieldSearch = '';
    const hasMissing =
      mode === 'executive'
        ? hiddenExecutiveFacts.length
        : mode === 'context'
          ? hiddenContextFacts.length
          : hiddenStack.length;
    fieldFilter = missingOnly && hasMissing ? 'missing' : 'all';
    addOpen = true;
  }
  function chooseField(choice: (typeof fieldChoices)[number]) {
    addOpen = false;
    if (choice.fact) openFactEditor(choice.fact, canWriteSites);
    if (choice.entry) openStackEditor(choice.entry, canWriteSites);
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

<div class="sw-page sw-profile">
  <div class="sw-section-heading">
    <div>
      <p class="sw-eyebrow">Client profile</p>
      <h2>Overview</h2>
      <p>Keep business details, technology ownership, and support instructions in one place.</p>
    </div>
    <Button onclick={() => openAddDialog('executive', false)} class="gap-2"
      ><ListChecks size={15} />{canWriteSites ? 'Manage profile' : 'Browse profile'}</Button
    >
  </div>
  <div class="sw-profile-guidance">
    <span class="sw-guidance-icon"><ListChecks size={20} /></span>
    <div class="sw-guidance-copy">
      <strong
        >{!profileDetailCount
          ? 'No profile fields configured'
          : missingCount
            ? `${missingCount} details still need documenting`
            : 'Your profile is documented'}</strong
      >
      <p>
        {!profileDetailCount
          ? 'A workspace administrator can configure the fields and technology categories available to your team.'
          : canWriteSites
            ? 'Choose a section below to fill a gap, update a value, or mark a field as not applicable.'
            : 'You have read-only access. Browse the profile and ask a site administrator to update missing details.'}
      </p>
      <div class="sw-gap-actions">
        <button onclick={() => openAddDialog('executive')}
          >Executive <span>{hiddenExecutiveFacts.length} missing</span><ChevronRight
            size={13}
          /></button
        >
        <button onclick={() => openAddDialog('context')}
          >Business context <span>{hiddenContextFacts.length} missing</span><ChevronRight
            size={13}
          /></button
        >
        <button onclick={() => openAddDialog('stack')}
          >Technology <span>{hiddenStack.length} missing</span><ChevronRight size={13} /></button
        >
      </div>
    </div>
    {#if profileDetailCount}<div class="sw-profile-progress">
        <strong>{profile.completeness.value}%</strong><span>Profile fields complete</span><progress
          max="100"
          value={profile.completeness.value}
          aria-label="Profile field completeness"
        ></progress><small
          >{profile.completeness.completeCount} of {profile.completeness.applicableCount} applicable fields</small
        >
      </div>{/if}
  </div>

  {#if catalogQuery.isError}<div class="sw-notice" role="alert">
      Profile editing is unavailable because field options could not be loaded.<button
        onclick={() => catalogQuery.refetch()}>Try again</button
      >
    </div>{/if}
  <div class="grid gap-4 xl:grid-cols-[minmax(0,2fr)_minmax(320px,1fr)]">
    <div class="space-y-4">
      <SectionPanel title="Executive" description="Who the client is and how they are supported.">
        {#snippet aside()}
          <Button
            variant="outline"
            size="sm"
            onclick={() => openAddDialog('executive')}
            class="gap-1.5"
          >
            {#if canWriteSites}<Plus size={14} />{hiddenExecutiveFacts.length
                ? 'Add field'
                : 'Manage fields'}{:else}Browse fields{/if}
          </Button>
        {/snippet}
        {#if executiveFacts.length}
          <dl>
            {#each executiveFacts as fact (fact.key)}
              <button
                type="button"
                class="sw-editable-fact"
                disabled={canWriteSites && (catalogQuery.isPending || catalogQuery.isError)}
                onclick={() => openFactEditor(fact, canWriteSites)}
              >
                <FactRow label={factLabel(fact)} {fact} /><span class="sw-edit-affordance"
                  >{#if canWriteSites}<Pencil size={13} />{:else}<ChevronRight
                      size={14}
                    />{/if}</span
                >
              </button>
            {/each}
          </dl>
        {:else}
          <p class="text-xs leading-relaxed text-muted-foreground">
            {#if hiddenExecutiveFacts.length}No details recorded yet.{#if canWriteSites} Choose Add field to record the first detail.{/if}{:else}No fields configured for this section. Open {canWriteSites ? 'Manage profile' : 'Browse profile'} to review the available sections.{/if}
          </p>
        {/if}
      </SectionPanel>

      <SectionPanel
        title="Technology stack"
        description="Products, vendors, and who manages each part of the environment."
      >
        {#snippet aside()}
          <Button
            variant="outline"
            size="sm"
            onclick={() => openAddDialog('stack')}
            class="gap-1.5"
          >
            {#if canWriteSites}<Plus size={14} />{hiddenStack.length
                ? 'Add item'
                : 'Manage stack'}{:else}Browse stack{/if}
          </Button>
        {/snippet}
        {#if visibleStack.length}
          <dl>
            {#each visibleStack as entry (entry.categoryKey)}
              <button
                type="button"
                class="grid w-full grid-cols-[108px_minmax(0,1fr)] items-center gap-3 border-b border-border/50 py-[7px] text-left last:border-b-0 hover:bg-foreground/3 lg:grid-cols-[108px_minmax(0,1fr)_auto]"
                onclick={() => openStackEditor(entry, canWriteSites)}
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
                        class="ml-1 rounded-sm border border-border px-1 py-px font-mono text-[10px] uppercase tracking-wider text-muted-foreground"
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
          <p class="text-xs leading-relaxed text-muted-foreground">No technology recorded yet.</p>
        {/if}
      </SectionPanel>

      <SectionPanel title="Infrastructure metrics">
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

      <SectionPanel
        title="Business context"
        description="Operational details your team needs when supporting this site."
      >
        {#snippet aside()}
          <Button
            variant="outline"
            size="sm"
            onclick={() => openAddDialog('context')}
            class="gap-1.5"
          >
            {#if canWriteSites}<Plus size={14} />{hiddenContextFacts.length
                ? 'Add field'
                : 'Manage fields'}{:else}Browse fields{/if}
          </Button>
        {/snippet}
        {#if contextFacts.length}
          <dl>
            {#each contextFacts as fact (fact.key)}
              <button
                type="button"
                class="sw-editable-fact"
                disabled={canWriteSites && (catalogQuery.isPending || catalogQuery.isError)}
                onclick={() => openFactEditor(fact, canWriteSites)}
              >
                <FactRow label={factLabel(fact)} {fact} /><span class="sw-edit-affordance"
                  >{#if canWriteSites}<Pencil size={13} />{:else}<ChevronRight
                      size={14}
                    />{/if}</span
                >
              </button>
            {/each}
          </dl>
        {:else}
          <p class="text-xs leading-relaxed text-muted-foreground">
            {#if hiddenContextFacts.length}No details recorded yet.{#if canWriteSites} Choose Add field to record the first detail.{/if}{:else}No fields configured for this section. Open {canWriteSites ? 'Manage profile' : 'Browse profile'} to review the available sections.{/if}
          </p>
        {/if}
      </SectionPanel>
    </div>

    <aside class="space-y-4">
      <SectionPanel title="Special handling">
        {#snippet aside()}
          {#if canWriteSites}
            <button class="sw-inline-action" onclick={() => openNoteEditor('special', null)}>
              <Plus class="size-3" /> Add note
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
          <p class="text-xs leading-relaxed text-muted-foreground">No special handling</p>
        {/if}
      </SectionPanel>

      <SectionPanel title="Team knowledge">
        {#snippet aside()}
          {#if canWriteSites}
            <button class="sw-inline-action" onclick={() => openNoteEditor('tribal', null)}>
              <Plus class="size-3" /> Add note
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
          <p class="text-xs leading-relaxed text-muted-foreground">No team notes recorded.</p>
        {/if}
      </SectionPanel>

      <SectionPanel title="Groups">
        {#snippet aside()}
          {#if canWriteSites}
            <button
              type="button"
              class="sw-inline-action"
              aria-label="Add site to group"
              title="Add to group"
              onclick={openGroupDialog}
            >
              <Plus class="size-3.5" /> Add to group
            </button>
          {/if}
        {/snippet}
        {#if groupsQuery.isLoading}
          <p class="text-xs leading-relaxed text-muted-foreground">loading…</p>
        {:else if groupsQuery.isError}
          <div class="sw-notice" role="alert">
            Groups could not be loaded.<button onclick={() => groupsQuery.refetch()}
              >Try again</button
            >
          </div>
        {:else if (groupsQuery.data ?? []).length}
          <div class="space-y-1">
            {#each groupsQuery.data ?? [] as group (group.id)}
              <div
                class="flex items-center justify-between gap-2 border-b border-border/40 py-1.5 text-sm last:border-b-0"
              >
                <a href={`/groups/${group.id}`} class="min-w-0 flex-1 hover:text-primary">
                  <div class="truncate">{group.name}</div>
                  {#if group.description}
                    <div class="truncate text-xs text-muted-foreground">{group.description}</div>
                  {/if}
                </a>
                {#if canWriteSites}
                  <button
                    type="button"
                    class="inline-flex size-5 shrink-0 items-center justify-center text-muted-foreground hover:text-destructive"
                    aria-label={`Remove from ${group.name}`}
                    title="Remove from group"
                    onclick={() => removeGroup(group.id)}
                  >
                    <X class="size-3.5" />
                  </button>
                {/if}
              </div>
            {/each}
          </div>
        {:else}
          <p class="text-xs leading-relaxed text-muted-foreground">not a member of any group</p>
        {/if}
      </SectionPanel>

      <SectionPanel title="Integrations">
        {#snippet aside()}
          {profile.integrations.length} linked
        {/snippet}
        {#if profile.integrations.length}
          <div>
            {#each profile.integrations as link (link.id)}
              <a
                href={integrationHref(link)}
                class="flex items-center justify-between gap-3 border-b border-border/40 py-2 text-sm transition-colors last:border-b-0 hover:bg-muted/40"
              >
                <div class="flex min-w-0 items-baseline gap-2">
                  <span
                    class={`size-1.5 shrink-0 translate-y-px rounded-full ${
                      link.status === 'active' || link.status === 'mapping'
                        ? 'bg-primary'
                        : link.status === 'error'
                          ? 'bg-destructive'
                          : 'bg-muted-foreground'
                    }`}
                  ></span>
                  <div class="min-w-0">
                    <div class="truncate">{link.name ?? providerName(link.integrationId)}</div>
                    <div
                      class="truncate font-mono text-[10.5px] uppercase tracking-wider text-muted-foreground"
                    >
                      {providerName(link.integrationId)}
                    </div>
                  </div>
                </div>
                <ArrowUpRight class="size-3 shrink-0 text-muted-foreground" />
              </a>
            {/each}
          </div>
        {:else}
          <p class="text-xs leading-relaxed text-muted-foreground">no integrations linked</p>
        {/if}
      </SectionPanel>
      <SectionPanel title="Profile sources" description="Know where each detail comes from.">
        <Legend />
        <p class="mt-3 text-xs leading-relaxed text-muted-foreground">
          Select a field to {canWriteSites
            ? 'edit its value and review its source.'
            : 'review its value and source.'} Synced values retain their source labels.
        </p>
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
  <Dialog.Content class="sw-field-library sm:max-w-[640px]">
    <Dialog.Header
      ><Dialog.Title>{canWriteSites ? 'Manage profile' : 'Browse profile'}</Dialog.Title
      ><Dialog.Description
        >Choose a detail to {canWriteSites ? 'add or update' : 'review'} for {site.name}. Missing
        details appear first.</Dialog.Description
      ></Dialog.Header
    >
    <Dialog.Body>
      <div class="sw-library-tabs" aria-label="Profile sections">
        {#each [{ key: 'executive', label: 'Executive' }, { key: 'context', label: 'Business context' }, { key: 'stack', label: 'Technology' }] as section}
          <button
            aria-pressed={addMode === section.key}
            onclick={() => {
              addMode = section.key as AddMode;
              fieldSearch = '';
            }}>{section.label}</button
          >
        {/each}
      </div>
      <div class="sw-library-toolbar">
        <div class="relative flex-1">
          <Search size={15} class="absolute left-3 top-3 text-muted-foreground" /><Input
            aria-label="Search profile fields"
            placeholder="Search fields and values…"
            bind:value={fieldSearch}
            class="pl-9"
          />
        </div>
        <label class="sw-filter-label"
          >Show<select bind:value={fieldFilter}
            ><option value="missing">Missing details</option><option value="all">All details</option
            ></select
          ></label
        >
      </div>
      {#if catalogQuery.isError}<div class="sw-notice" role="alert">
          Field options could not be loaded.<button onclick={() => catalogQuery.refetch()}
            >Try again</button
          >
        </div>{/if}
      <div class="sw-field-choices">
        {#each visibleFieldChoices as choice (choice.key)}
          <button
            class="sw-field-choice"
            onclick={() => chooseField(choice)}
            disabled={catalogQuery.isPending || catalogQuery.isError}
          >
            <span class="sw-field-choice-icon"
              >{#if choice.missing}<Plus size={16} />{:else}<ShieldCheck size={16} />{/if}</span
            >
            <span class="sw-field-choice-copy"
              ><strong>{choice.label}</strong><small>{choice.detail}</small></span
            >
            <span class="sw-field-choice-action"
              >{canWriteSites ? (choice.missing ? 'Add' : 'Edit') : 'View'}<ChevronRight
                size={14}
              /></span
            >
          </button>
        {:else}
          <div class="sw-library-empty">
            <ListChecks size={24} /><strong
              >{fieldSearch
                ? 'No matching details'
                : fieldFilter === 'missing' && fieldChoices.length
                  ? 'Nothing missing in this section'
                  : 'No fields configured for this section'}</strong
            >
            <p>
              {fieldSearch
                ? 'Try another field name or value.'
                : fieldChoices.length
                  ? 'You can still review and update existing values.'
                  : 'A workspace administrator can configure the profile fields available to your team.'}
            </p>
            {#if fieldChoices.length}<Button
                variant="outline"
                size="sm"
                onclick={() => {
                  fieldSearch = '';
                  fieldFilter = 'all';
                }}>Show all details</Button
              >{/if}
          </div>
        {/each}
      </div>
    </Dialog.Body>
    <Dialog.Footer
      ><span class="mr-auto text-xs text-muted-foreground"
        >{visibleFieldChoices.length} of {fieldChoices.length} details</span
      ><Button variant="outline" onclick={() => (addOpen = false)}>Done</Button></Dialog.Footer
    >
  </Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={groupDialogOpen}>
  <Dialog.Content class="sm:max-w-[420px]">
    <Dialog.Header>
      <Dialog.Title>
        {groupDialogMode === 'add' ? 'Add to group' : 'Create group'}
      </Dialog.Title>
      <Dialog.Description>
        {groupDialogMode === 'add'
          ? 'Add this site to an existing group.'
          : 'Create a new group and add this site to it.'}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>
    <div class="grid gap-3">
      <div class="flex gap-2 text-xs">
        <button
          type="button"
          class={`rounded-sm border px-2 py-1 ${
            groupDialogMode === 'add'
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          } disabled:opacity-40`}
          disabled={!availableGroupOptions.length}
          onclick={() => (groupDialogMode = 'add')}
        >
          Existing
        </button>
        <button
          type="button"
          class={`rounded-sm border px-2 py-1 ${
            groupDialogMode === 'create'
              ? 'border-primary bg-primary/10 text-foreground'
              : 'border-border text-muted-foreground hover:text-foreground'
          }`}
          onclick={() => (groupDialogMode = 'create')}
        >
          New group
        </button>
      </div>

      {#if groupDialogMode === 'add'}
        {#if availableGroupOptions.length}
          <SingleSelect
            options={availableGroupOptions}
            bind:selected={selectedGroupId}
            placeholder="Select group..."
            searchPlaceholder="Search groups..."
          />
        {:else}
          <p class="text-xs text-muted-foreground">
            No other groups available. Create a new one.
          </p>
        {/if}
      {:else}
        <label class="grid gap-1 text-xs font-medium text-muted-foreground">
          Name
          <input
            type="text"
            bind:value={newGroupName}
            class="rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            placeholder="e.g. Northeast region"
          />
        </label>
        <label class="grid gap-1 text-xs font-medium text-muted-foreground">
          Description
          <textarea
            bind:value={newGroupDescription}
            rows="2"
            class="rounded-sm border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-primary focus:outline-none"
            placeholder="Optional"
          ></textarea>
        </label>
      {/if}
    </div>


    </Dialog.Body><Dialog.Footer>
      <button
        type="button"
        class="rounded-sm px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground"
        onclick={() => (groupDialogOpen = false)}
      >
        Cancel
      </button>
      <button
        type="button"
        class="rounded-sm bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-40"
        disabled={savingGroup ||
          (groupDialogMode === 'add' ? !selectedGroupId : !newGroupName.trim())}
        onclick={saveGroupSelection}
      >
        {groupDialogMode === 'add' ? 'Add' : 'Create'}
      </button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
