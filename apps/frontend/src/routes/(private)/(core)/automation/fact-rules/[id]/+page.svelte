<script lang="ts">
  import '../../workspace.css';
  import { fieldLabel } from '$lib/utils/label';
  import { PolicyTableShapes, type FieldDefinition } from '@mspbyte/shared';
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
  const id = $derived(page.params.id ?? '');
  const canWrite = $derived(authStore.isAllowed('Policies.Write'));

  const ruleQuery = createQuery(() => ({
    queryKey: ['factRules.byId', id],
    queryFn: () => trpc.factRules.byId.query({ id }),
    enabled: Boolean(id),
  }));

  const rule = $derived(ruleQuery.data);

  function isRecord(v: unknown): v is Record<string, unknown> {
    return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
  }

  const def = $derived(isRecord(rule?.definition) ? rule!.definition : {});

  const aggregateLabel: Record<string, string> = {
    exists: 'Check whether a match exists',
    count: 'Count matching records',
    value: 'Use a value from the first match',
    collect: 'Collect unique values',
    conditional: 'Use the first matching case',
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

  const fieldNames = $derived.by(() => {
    const labels = new Map<string, string>();
    function collect(shape: Record<string, FieldDefinition>) {
      for (const field of Object.values(shape)) {
        labels.set(field.ingestPath, field.label);
        if (field.type === 'object' && field.fields) collect(field.fields);
      }
    }
    const shape = PolicyTableShapes.find((entry) => entry.table === String(def.table ?? ''));
    if (shape) collect(shape.shape);
    return labels;
  });
  const operatorLabels: Record<string, string> = {
    eq: 'equals',
    ne: 'does not equal',
    gt: 'is greater than',
    gte: 'is at least',
    lt: 'is less than',
    lte: 'is at most',
    contains: 'contains',
    notContains: 'does not contain',
    containsAny: 'contains any of',
    notContainsAny: 'contains none of',
    exists: 'has a value',
    missing: 'is missing',
    olderThanDays: 'is older than this many days',
    withinDays: 'is within this many days',
  };
  function displayValue(value: unknown): string {
    if (value === true) return 'Yes';
    if (value === false) return 'No';
    if (value == null) return 'No value';
    return Array.isArray(value)
      ? value.map(displayValue).join(', ')
      : typeof value === 'object'
        ? JSON.stringify(value)
        : String(value);
  }
  let toggling = $state(false);
  async function toggleEnabled() {
    if (!rule || toggling) return;
    const nextEnabled = !rule.enabled;
    toggling = true;
    try {
      await trpc.factRules.update.mutate({
        id: rule.id,
        name: rule.name,
        description: rule.description,
        enabled: nextEnabled,
        providerId: rule.providerId,
        factKey: rule.factKey,
        priority: rule.priority,
        definition: rule.definition as Record<string, unknown>,
      });
      await queryClient.invalidateQueries({ queryKey: ['factRules.byId', id] });
      await queryClient.invalidateQueries({ queryKey: ['factRules.list'] });
      toast.success(nextEnabled ? 'Rule enabled' : 'Rule disabled');
    } catch (error) {
      showErrorToast(error, 'Failed to update rule');
    } finally {
      toggling = false;
    }
  }
</script>

{#snippet conditions(filter: unknown)}
  {#if isRecord(filter) && Array.isArray(filter.conditions) && filter.conditions.length}
    <p class="mb-3">
      Match {String(filter.logic ?? 'AND').toUpperCase() === 'OR' ? 'any' : 'all'} of these conditions:
    </p>
    <div class="space-y-2">
      {#each filter.conditions as condition}{#if isRecord(condition)}<div class="au-condition">
            <b
              >{fieldNames.get(String(condition.field)) ??
                fieldLabel(String(condition.field ?? 'Field'))}</b
            ><span>{operatorLabels[String(condition.op)] ?? String(condition.op)}</span
            >{#if condition.value !== undefined}<b>{displayValue(condition.value)}</b>{/if}
          </div>{/if}{/each}
    </div>
  {:else}<p>Include all available records for the site.</p>{/if}
{/snippet}
{#if ruleQuery.isLoading}
  <div class="au-page"><p class="text-sm text-muted-foreground">Loading rule…</p></div>
{:else if ruleQuery.error || !rule}
  <div class="au-page">
    <div class="au-error" role="alert">
      <h2>We couldn’t load this rule</h2>
      <p>It may have been removed, or your access may have changed.</p>
      <div class="flex gap-2">
        <Button variant="outline" href="/automation/fact-rules">All fact rules</Button><Button
          onclick={() => ruleQuery.refetch()}>Try again</Button
        >
      </div>
    </div>
  </div>
{:else}
  <div class="au-detail">
    <div class="au-backbar">
      <a class="text-sm text-muted-foreground" href="/automation/fact-rules">← All fact rules</a>
    </div>
    <div class="overflow-auto">
      <div class="au-detail-body">
        <header class="au-heading">
          <div>
            <p class="au-eyebrow">Automation / Fact rule</p>
            <h1>{rule.name}</h1>
            <p>
              {rule.description || 'Keep a site profile field up to date after each data sync.'}
            </p>
          </div>
          <div class="au-heading-actions">
            {#if canWrite}<label class="flex items-center gap-2 text-sm"
                ><Switch
                  checked={rule.enabled}
                  onchange={toggleEnabled}
                  disabled={toggling}
                />{rule.enabled ? 'Enabled' : 'Disabled'}</label
              ><Button
                class="gap-2"
                onclick={() => goto(`/automation/fact-rules/builder?id=${rule.id}`)}
                ><Pencil size={15} /> Edit rule</Button
              >{:else}<span class="text-sm text-muted-foreground"
                >{rule.enabled ? 'Enabled' : 'Disabled'} · View only</span
              >{/if}
          </div>
        </header>
        <div class="au-notice" class:au-success={rule.enabled}>
          <div>
            <strong
              >{rule.enabled
                ? 'This rule updates site profiles after data syncs'
                : 'This rule is disabled'}</strong
            >
            <p>
              {rule.enabled
                ? `Reads ${rule.dataSource} and writes to ${fieldLabel(rule.factKey)}.`
                : 'Existing site values stay in place. Enable the rule to apply it during future syncs.'}
            </p>
          </div>
        </div>
        <div class="au-rule-grid">
          <div class="au-rule-flow">
            <section class="au-rule-section">
              <span class="au-eyebrow">1 · Read</span>
              <h2>{rule.dataSource}</h2>
              <p>Use records from this source within each site’s available data.</p>
            </section>
            <section class="au-rule-section">
              <span class="au-eyebrow">2 · Match</span>
              <h2>Choose which records count</h2>
              {@render conditions(def.filter)}
            </section>
            <section class="au-rule-section">
              <span class="au-eyebrow">3 · Update</span>
              <h2>{fieldLabel(rule.factKey)}</h2>
              <p>{aggregateLabel[aggregate] ?? aggregate}</p>
              {#if aggregate === 'exists'}<dl class="mt-4 sm:grid-cols-2">
                  <div>
                    <dt>When a match is found</dt>
                    <dd>{displayValue(def.outputTrue ?? true)}</dd>
                  </div>
                  <div>
                    <dt>When nothing matches</dt>
                    <dd>{displayValue(def.outputFalse ?? false)}</dd>
                  </div>
                </dl>
              {:else if aggregate === 'value' || aggregate === 'collect'}<dl
                  class="mt-4 sm:grid-cols-2"
                >
                  <div>
                    <dt>Use this field</dt>
                    <dd>
                      {fieldNames.get(String(def.valueField)) ??
                        fieldLabel(String(def.valueField ?? 'Not selected'))}
                    </dd>
                  </div>
                  <div>
                    <dt>Format the value</dt>
                    <dd>
                      {transformLabel[String(def.transform ?? 'none')] ?? String(def.transform)}
                    </dd>
                  </div>
                </dl>
              {:else if aggregate === 'conditional'}
                {#each defCases as c, i}{#if isRecord(c)}<div class="au-rule-case">
                      <h3>{c.default ? 'When no case matches' : `Case ${i + 1}`}</h3>
                      {#if !c.default}{@render conditions(c.filter)}{/if}
                      <div class="au-rule-output">
                        <span>Write</span><strong>{displayValue(c.output)}</strong>
                      </div>
                    </div>{/if}{/each}
                {#if !defCases.some((c) => isRecord(c) && c.default)}<p class="mt-4">
                    If no case matches, the rule leaves the existing site value unchanged.
                  </p>{/if}
              {/if}
            </section>
          </div>
          <aside class="au-rule-section">
            <h2>Rule settings</h2>
            <dl>
              <div>
                <dt>Site field identifier</dt>
                <dd>{rule.factKey}</dd>
              </div>
              <div>
                <dt>Priority</dt>
                <dd>{rule.priority}</dd>
                <p>Lower numbers take priority when rules update the same field.</p>
              </div>
              <div>
                <dt>Integration</dt>
                <dd>
                  {rule.providerId ? fieldLabel(rule.providerId) : 'Any available integration'}
                </dd>
              </div>
              <div>
                <dt>Last updated</dt>
                <dd>{rule.updatedAt ? new Date(rule.updatedAt).toLocaleDateString() : '—'}</dd>
              </div>
            </dl>
          </aside>
        </div>
      </div>
    </div>
  </div>
{/if}
