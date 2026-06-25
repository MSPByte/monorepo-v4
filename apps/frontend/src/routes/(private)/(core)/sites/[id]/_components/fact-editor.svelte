<script lang="ts">
  import { getContext } from 'svelte';
  import { createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { toast } from 'svelte-sonner';

  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as Select from '$lib/components/ui/select/index.js';
  import { Button } from '$lib/components/ui/button';
  import { Input } from '$lib/components/ui/input';
  import { Label } from '$lib/components/ui/label';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import Plus from '@lucide/svelte/icons/plus';
  import Trash from '@lucide/svelte/icons/trash-2';

  import type { ProfileFact } from '../_profile/client-profile.types';
  import { prettyText } from '$lib/utils/format';
  import Separator from '$lib/components/ui/separator/separator.svelte';

  type CatalogField = {
    key: string;
    label: string;
    type: 'string' | 'number' | 'boolean';
    valueMode: 'single' | 'multiple';
    values: string[] | null;
  };

  let {
    siteId,
    fact,
    field,
    canWrite = false,
    canDelete = false,
    initialEditing = false,
    open = $bindable(),
  }: {
    siteId: string;
    fact: ProfileFact;
    field: CatalogField | null;
    canWrite?: boolean;
    canDelete?: boolean;
    initialEditing?: boolean;
    open: boolean;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  type ApplicableState = 'applies' | 'not_applicable' | 'unknown';

  let applicable = $state<ApplicableState>(fact.applicable);
  let stringValue = $state('');
  let listValue = $state<string[]>([]);
  let newListValue = $state('');
  let numberValue = $state<number | undefined>(undefined);
  let boolValue = $state<'true' | 'false'>('false');
  let supportHoursMode = $state<'range' | '24x7'>('range');
  let supportStart = $state('08:00');
  let supportEnd = $state('17:00');
  let editing = $state(false);

  $effect(() => {
    if (open) {
      editing = canWrite && initialEditing;
      applicable = fact.applicable === 'unknown' ? 'applies' : fact.applicable;
      const v = fact.value;
      if (field?.valueMode === 'multiple') {
        listValue = Array.isArray(v) ? v.map(String) : typeof v === 'string' && v ? [v] : [];
        newListValue = '';
      } else if (fact.key === 'support_hours') {
        const text = v == null ? '' : String(v);
        if (text === '24x7') {
          supportHoursMode = '24x7';
        } else {
          supportHoursMode = 'range';
          const match = text.match(/^(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})$/);
          supportStart = match?.[1] ?? '08:00';
          supportEnd = match?.[2] ?? '17:00';
        }
      } else if (field?.type === 'number') {
        numberValue = typeof v === 'number' ? v : v == null || v === '' ? undefined : Number(v);
      } else if (field?.type === 'boolean') {
        boolValue = v === true || v === 'true' ? 'true' : 'false';
      } else {
        stringValue = v == null ? '' : String(v);
      }
    }
  });

  function addListValue(value = newListValue) {
    const trimmed = value.trim();
    if (!trimmed || listValue.includes(trimmed)) return;
    listValue = [...listValue, trimmed];
    newListValue = '';
  }

  function removeListValue(index: number) {
    listValue = listValue.filter((_, i) => i !== index);
  }

  function labelForValue(value: string) {
    const special: Record<string, string> = {
      critical: 'Critical',
      mission_critical: 'Critical',
      low: 'Low',
      medium: 'Medium',
      high: 'High',
      active: 'Active',
      prospect: 'Prospect',
      former: 'Former',
      internal: 'Internal',
      standard: 'Standard',
      premium: 'Premium',
      enterprise: 'Enterprise',
      yes: 'Yes',
      no: 'No',
      unknown: 'Unknown',
      on_call: 'On call',
      cab_only: 'CAB only',
      business_hours: 'Business hours',
      extended_hours: 'Extended hours',
      '24x7': '24/7',
      SMB: 'SMB',
      'Mid-market': 'Mid-market',
      Enterprise: 'Enterprise',
    };
    return (
      special[value] ?? value.replace(/_/g, ' ').replace(/\b\w/g, (char) => char.toUpperCase())
    );
  }

  const optionItems = $derived(
    (field?.values ?? []).map((value) => ({ value, label: labelForValue(value) }))
  );

  const factDisplay = $derived.by(() => {
    if (fact.applicable === 'not_applicable') return 'Not applicable';
    if (
      fact.applicable === 'unknown' ||
      fact.value === null ||
      fact.value === undefined ||
      fact.value === '' ||
      (Array.isArray(fact.value) && fact.value.length === 0)
    ) {
      return 'Unknown';
    }
    if (Array.isArray(fact.value)) return fact.value.map(labelForValue).join(', ');
    if (typeof fact.value === 'boolean') return fact.value ? 'Yes' : 'No';
    if (typeof fact.value === 'number') return fact.value.toLocaleString();
    return labelForValue(String(fact.value));
  });

  const save = createMutation(() => ({
    mutationFn: () => {
      let value: string | number | boolean | string[] | null = null;
      let source: 'user_options' | 'user_free' = 'user_free';
      if (applicable === 'not_applicable') {
        value = null;
      } else if (field?.valueMode === 'multiple') {
        const values = newListValue.trim() ? [...listValue, newListValue.trim()] : listValue;
        value = [...new Set(values.map((v) => v.trim()).filter(Boolean))];
        source = field.values?.length ? 'user_options' : 'user_free';
      } else if (fact.key === 'support_hours') {
        value = supportHoursMode === '24x7' ? '24x7' : `${supportStart} - ${supportEnd}`;
        source = 'user_options';
      } else if (field?.type === 'number') {
        value = numberValue ?? null;
      } else if (field?.type === 'boolean') {
        value = boolValue === 'true';
        source = 'user_options';
      } else if (field?.values && field.values.length) {
        value = stringValue || null;
        source = 'user_options';
      } else {
        value = stringValue || null;
      }
      return trpc.siteProfile.upsertFact.mutate({
        siteId,
        key: fact.key,
        value,
        source,
        origin: 'manual',
        applicable,
      });
    },
    onSuccess: () => {
      editing = false;
      open = false;
      toast.success('Fact saved');
      qc.invalidateQueries({ queryKey: ['sites.profileById', siteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  const clear = createMutation(() => ({
    mutationFn: () => trpc.siteProfile.deleteFact.mutate({ siteId, key: fact.key }),
    onSuccess: () => {
      editing = false;
      open = false;
      toast.success('Cleared');
      qc.invalidateQueries({ queryKey: ['sites.profileById', siteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Clear failed'),
  }));
</script>

<Dialog.Root bind:open>
  <Dialog.Content class="sm:max-w-[440px]">
    <Dialog.Header>
      <Dialog.Title>{fact.label}</Dialog.Title>
      <Dialog.Description
        >{editing
          ? 'Set a value, mark as not applicable, or leave it unknown.'
          : 'Review the recorded value and source context.'}</Dialog.Description
      >
    </Dialog.Header>
    <Separator />
    {#if !editing}
      <div class="grid gap-3 p-4">
        <div class="grid gap-1">
          <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Applicability
          </div>
          <div class="text-sm">{prettyText(fact.applicable)}</div>
        </div>
        <div class="grid gap-1">
          <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Value
          </div>
          <div class="text-sm">{factDisplay}</div>
        </div>
        {#if fact.origin || fact.updatedAt}
          <div class="grid gap-1">
            <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Source
            </div>
            <div class="text-sm text-muted-foreground">
              {fact.origin ?? 'manual'}{fact.updatedAt ? ` · ${fact.updatedAt}` : ''}
            </div>
          </div>
        {/if}
      </div>
    {:else}
      <div class="grid gap-3 p-4">
        <div class="grid gap-1.5">
          <Label>Applicability</Label>
          <Select.Root
            type="single"
            value={applicable}
            onValueChange={(v) => v && (applicable = v as ApplicableState)}
          >
            <Select.Trigger>
              {prettyText(applicable)}
            </Select.Trigger>
            <Select.Content>
              <Select.Item value="applies">Applies</Select.Item>
              <Select.Item value="not_applicable">Not Applicable</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>

        {#if applicable === 'applies'}
          <div class="grid gap-1.5">
            <Label>Value</Label>
            {#if fact.key === 'support_hours'}
              <div class="grid gap-3 rounded-md border border-border bg-muted/20 p-3">
                <Select.Root
                  type="single"
                  value={supportHoursMode}
                  onValueChange={(v) => v && (supportHoursMode = v as 'range' | '24x7')}
                >
                  <Select.Trigger>
                    {supportHoursMode === '24x7' ? '24/7' : 'Time range'}
                  </Select.Trigger>
                  <Select.Content>
                    <Select.Item value="range">Time range</Select.Item>
                    <Select.Item value="24x7">24/7</Select.Item>
                  </Select.Content>
                </Select.Root>

                {#if supportHoursMode === 'range'}
                  <div class="grid grid-cols-[1fr_auto_1fr] items-end gap-2">
                    <div class="grid gap-1.5">
                      <Label for="support-start">Start</Label>
                      <Input id="support-start" type="time" bind:value={supportStart} />
                    </div>
                    <span class="pb-2 text-xs text-muted-foreground">to</span>
                    <div class="grid gap-1.5">
                      <Label for="support-end">Stop</Label>
                      <Input id="support-end" type="time" bind:value={supportEnd} />
                    </div>
                  </div>
                {/if}
              </div>
            {:else if field?.valueMode === 'multiple'}
              <div class="space-y-2">
                {#if field.values && field.values.length}
                  <MultiSelect
                    options={optionItems}
                    bind:selected={listValue}
                    placeholder="Select values..."
                    searchPlaceholder="Search values..."
                    maxDisplay={2}
                  />
                {:else}
                  <div class="flex gap-2">
                    <Input
                      bind:value={newListValue}
                      placeholder="Add a value"
                      onkeydown={(event) => {
                        if (event.key === 'Enter') {
                          event.preventDefault();
                          addListValue();
                        }
                      }}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="icon"
                      onclick={() => addListValue()}
                    >
                      <Plus class="size-4" />
                    </Button>
                  </div>
                {/if}
                {#if listValue.length}
                  <div class="flex flex-wrap gap-1.5">
                    {#each listValue as item, index (item)}
                      <span
                        class="inline-flex items-center gap-1 rounded-[3px] border border-border px-1.5 py-0.5 text-xs"
                      >
                        {labelForValue(item)}
                        <button
                          type="button"
                          class="text-muted-foreground hover:text-destructive"
                          onclick={() => removeListValue(index)}
                        >
                          <Trash class="size-3" />
                        </button>
                      </span>
                    {/each}
                  </div>
                {:else if !listValue.length}
                  <p class="text-[11px] text-muted-foreground">No values added.</p>
                {/if}
              </div>
            {:else if field?.type === 'number'}
              <Input type="number" bind:value={numberValue} />
            {:else if field?.type === 'boolean'}
              <Select.Root
                type="single"
                value={boolValue}
                onValueChange={(v) => v && (boolValue = v as 'true' | 'false')}
              >
                <Select.Trigger>{boolValue}</Select.Trigger>
                <Select.Content>
                  <Select.Item value="true">True</Select.Item>
                  <Select.Item value="false">False</Select.Item>
                </Select.Content>
              </Select.Root>
            {:else if field?.values && field.values.length}
              <SingleSelect
                options={optionItems}
                bind:selected={stringValue}
                placeholder="Select value..."
                searchPlaceholder="Search values..."
              />
            {:else}
              <Input bind:value={stringValue} placeholder="Type a value" />
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <Dialog.Footer>
      {#if fact.updatedAt !== null && canDelete}
        <Button
          variant="destructive"
          onclick={() => clear.mutate()}
          disabled={clear.isPending || save.isPending}
        >
          Clear
        </Button>
      {/if}
      <div class="flex-1"></div>
      {#if editing}
        <Button variant="ghost" onclick={() => (editing = false)}>Cancel</Button>
        <Button
          onclick={() => save.mutate()}
          disabled={save.isPending || clear.isPending || !canWrite}>Save</Button
        >
      {:else}
        <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
        {#if canWrite}
          <Button onclick={() => (editing = true)}>Edit</Button>
        {/if}
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
