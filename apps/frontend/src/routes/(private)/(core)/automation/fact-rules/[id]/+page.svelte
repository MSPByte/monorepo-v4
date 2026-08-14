<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { Pencil } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const id = $derived(page.params.id);
  const canWrite = $derived(authStore.isAllowed('Policies.Write'));

  const ruleQuery = createQuery(() => ({
    queryKey: ['factRules.byId', id],
    queryFn: () => trpc.factRules.byId.query({ id }),
  }));

  const rule = $derived(ruleQuery.data);

  function isRecord(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  }

  const def = $derived(isRecord(rule?.definition) ? rule!.definition : {});

  const aggregateLabel: Record<string, string> = {
    exists: 'Exists (true/false)',
    count: 'Count',
    value: 'Value (first match)',
    collect: 'Collect (array)',
    conditional: 'Conditional (first match wins)',
  };

  const transformLabel: Record<string, string> = {
    none: 'None',
    afterAt: 'Domain from email (after @)',
    beforeAt: 'Username from email (before @)',
    afterLastDot: 'Extension (after last .)',
    beforeLastDot: 'Without extension (before last .)',
    lowercase: 'Lowercase',
    uppercase: 'Uppercase',
    trim: 'Trim whitespace',
  };

  const aggregate = $derived(isRecord(def) ? String(def.aggregate ?? 'exists') : 'exists');
  const defCases = $derived(isRecord(def) && Array.isArray(def.cases) ? def.cases : []);

  let toggling = $state(false);
  async function toggleEnabled() {
    if (!rule || toggling) return;
    toggling = true;
    try {
      await trpc.factRules.update.mutate({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled: !rule.enabled,
        providerId: rule.providerId,
        factKey: rule.factKey,
        priority: rule.priority,
        definition: rule.definition as Record<string, unknown>,
      });
      await queryClient.invalidateQueries({ queryKey: ['factRules.byId', id] });
      await queryClient.invalidateQueries({ queryKey: ['factRules.list'] });
      toast.success(rule.enabled ? 'Rule disabled' : 'Rule enabled');
    } catch (error) {
      showErrorToast(error, 'Failed to update rule');
    } finally {
      toggling = false;
    }
  }
</script>

{#if ruleQuery.isLoading}
  <div class="flex size-full items-center justify-center text-sm text-muted-foreground">Loading…</div>
{:else if !rule}
  <div class="flex size-full items-center justify-center text-sm text-muted-foreground">Fact rule not found.</div>
{:else}
  <div class="flex size-full flex-col overflow-hidden">
    <!-- Header -->
    <header class="border-b bg-background px-6 py-4">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <button
            type="button"
            class="mb-1 text-xs text-muted-foreground hover:text-foreground"
            onclick={() => goto('/automation/fact-rules')}
          >
            ← All fact rules
          </button>
          <h1 class="truncate text-xl font-semibold">{rule.name}</h1>
          {#if rule.description}
            <p class="mt-0.5 text-sm text-muted-foreground">{rule.description}</p>
          {/if}
        </div>
        <div class="flex shrink-0 items-center gap-3">
          {#if canWrite}
            <label class="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground select-none">
              <Switch checked={rule.enabled} onchange={toggleEnabled} disabled={toggling} />
              {rule.enabled ? 'Enabled' : 'Disabled'}
            </label>
            <Button
              variant="outline"
              size="sm"
              class="gap-2"
              onclick={() => goto(`/automation/fact-rules/builder?id=${rule.id}`)}
            >
              <Pencil class="size-4" /> Edit
            </Button>
          {/if}
        </div>
      </div>
    </header>

    <!-- Body -->
    <div class="flex min-h-0 flex-1 gap-6 overflow-auto p-6">

      <!-- Main: definition -->
      <div class="flex-1 space-y-6">

        <!-- Output -->
        <section class="rounded-lg border">
          <div class="border-b px-4 py-3 bg-muted/30">
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Output</p>
          </div>
          <div class="grid grid-cols-2 gap-4 p-4 text-sm">
            <div>
              <p class="text-xs text-muted-foreground">Fact key</p>
              <p class="mt-0.5 font-mono font-medium">{rule.factKey}</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">Aggregate</p>
              <p class="mt-0.5 font-medium">{aggregateLabel[aggregate] ?? aggregate}</p>
            </div>
            {#if aggregate === 'exists'}
              {#if def.outputTrue !== undefined}
                <div>
                  <p class="text-xs text-muted-foreground">When matched</p>
                  <p class="mt-0.5 font-mono font-medium">{JSON.stringify(def.outputTrue)}</p>
                </div>
              {/if}
              {#if def.outputFalse !== undefined}
                <div>
                  <p class="text-xs text-muted-foreground">When not matched</p>
                  <p class="mt-0.5 font-mono font-medium">{JSON.stringify(def.outputFalse)}</p>
                </div>
              {/if}
            {:else if aggregate === 'value' || aggregate === 'collect'}
              {#if def.valueField}
                <div>
                  <p class="text-xs text-muted-foreground">Value field</p>
                  <p class="mt-0.5 font-mono font-medium">{def.valueField}</p>
                </div>
              {/if}
              {#if def.transform && def.transform !== 'none'}
                <div>
                  <p class="text-xs text-muted-foreground">Transform</p>
                  <p class="mt-0.5 font-medium">{transformLabel[String(def.transform)] ?? String(def.transform)}</p>
                </div>
              {/if}
            {/if}
          </div>

          {#if aggregate === 'conditional' && defCases.length > 0}
            <div class="border-t">
              <div class="space-y-3 p-4">
                {#each defCases as c, i}
                  {#if isRecord(c)}
                    <div class="rounded-md border text-sm">
                      <div class="border-b px-3 py-2 bg-muted/20 text-xs font-semibold text-muted-foreground">
                        {c.default ? 'Default' : `Case ${i + 1}`}
                      </div>
                      <div class="p-3 space-y-2">
                        {#if !c.default && isRecord(c.filter) && Array.isArray(c.filter.conditions)}
                          <div class="space-y-1">
                            {#each c.filter.conditions as condition}
                              {#if isRecord(condition)}
                                <div class="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-1.5 font-mono text-xs">
                                  <span>{condition.field}</span>
                                  <span class="text-muted-foreground">{condition.op}</span>
                                  {#if condition.value !== undefined}
                                    <span>{JSON.stringify(condition.value)}</span>
                                  {/if}
                                </div>
                              {/if}
                            {/each}
                          </div>
                        {/if}
                        <div class="flex items-center gap-2">
                          <span class="text-xs text-muted-foreground">Output:</span>
                          <span class="font-mono font-medium text-xs">{JSON.stringify(c.output)}</span>
                        </div>
                      </div>
                    </div>
                  {/if}
                {/each}
              </div>
            </div>
          {/if}
        </section>

        <!-- Data source -->
        <section class="rounded-lg border">
          <div class="border-b px-4 py-3 bg-muted/30">
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Data Source</p>
          </div>
          <div class="p-4 text-sm">
            <p class="text-xs text-muted-foreground">Source table</p>
            <p class="mt-0.5 font-medium">{rule.dataSource}</p>
          </div>
        </section>

        <!-- Filter -->
        <section class="rounded-lg border">
          <div class="border-b px-4 py-3 bg-muted/30">
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Candidate Filter</p>
          </div>
          <div class="p-4 text-sm">
            {#if isRecord(def.filter) && Array.isArray(def.filter.conditions) && def.filter.conditions.length > 0}
              <div class="space-y-2">
                {#each def.filter.conditions as condition}
                  {#if isRecord(condition)}
                    <div class="flex items-center gap-2 rounded-md border bg-muted/20 px-3 py-2 font-mono text-xs">
                      <span class="text-foreground">{condition.field}</span>
                      <span class="text-muted-foreground">{condition.op}</span>
                      {#if condition.value !== undefined}
                        <span class="text-foreground">{JSON.stringify(condition.value)}</span>
                      {/if}
                    </div>
                  {/if}
                {/each}
              </div>
            {:else}
              <p class="text-muted-foreground italic">No filter — all rows in scope are included.</p>
            {/if}
          </div>
        </section>
      </div>

      <!-- Sidebar: meta -->
      <aside class="w-64 shrink-0 space-y-4">
        <section class="rounded-lg border">
          <div class="border-b px-4 py-3 bg-muted/30">
            <p class="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">Details</p>
          </div>
          <div class="space-y-3 p-4 text-sm">
            <div>
              <p class="text-xs text-muted-foreground">Priority</p>
              <p class="mt-0.5 font-medium">{rule.priority}</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">Provider</p>
              <p class="mt-0.5 font-medium">{rule.providerId ?? 'Any'}</p>
            </div>
            <div>
              <p class="text-xs text-muted-foreground">Last updated</p>
              <p class="mt-0.5 font-medium">
                {rule.updatedAt ? new Date(rule.updatedAt).toLocaleDateString() : '—'}
              </p>
            </div>
          </div>
        </section>
      </aside>
    </div>
  </div>
{/if}
