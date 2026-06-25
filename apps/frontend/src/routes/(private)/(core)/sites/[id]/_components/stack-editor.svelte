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
  import { Textarea } from '$lib/components/ui/textarea';

  import type { StackEntry, StackMetadataField } from '../_profile/client-profile.types';
  import Separator from '$lib/components/ui/separator/separator.svelte';

  let {
    siteId,
    entry,
    canWrite = false,
    canDelete = false,
    initialEditing = false,
    open = $bindable(),
  }: {
    siteId: string;
    entry: StackEntry;
    canWrite?: boolean;
    canDelete?: boolean;
    initialEditing?: boolean;
    open: boolean;
  } = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const qc = useQueryClient();

  type Status =
    | 'msp_managed'
    | 'client_managed'
    | 'vendor_managed'
    | 'not_used'
    | 'planned'
    | 'unknown';
  type MetadataRow = StackMetadataField & { value: string };

  const relationshipLabels: Record<Status, string> = {
    msp_managed: 'Managed by us',
    client_managed: 'Managed by client',
    vendor_managed: 'Managed by vendor',
    not_used: 'Not used',
    planned: 'Planned',
    unknown: 'Unknown',
  };

  let status = $state<Status>(entry.status);
  let vendor = $state(entry.vendor ?? '');
  let product = $state(entry.product ?? '');
  let notes = $state(entry.notes ?? '');
  let metadataRows = $state<MetadataRow[]>([]);
  let editing = $state(false);

  function defaultRowsFor(fields: StackMetadataField[], values: Record<string, string> | null) {
    const defaults = fields.length
      ? fields
      : [
          { key: 'account_number', label: 'Account #', type: 'string' as const },
          { key: 'admin_url', label: 'Admin URL', type: 'url' as const },
          { key: 'support_contact', label: 'Support contact', type: 'string' as const },
        ];
    const used = new Set<string>();
    const rows: MetadataRow[] = defaults.map((row) => {
      used.add(row.key);
      return { required: false, helpText: null, ...row, value: values?.[row.key] ?? '' };
    });
    for (const [key, value] of Object.entries(values ?? {})) {
      if (!used.has(key))
        rows.push({
          key,
          label: key.replace(/_/g, ' '),
          type: 'string',
          required: false,
          helpText: null,
          value,
        });
    }
    return rows;
  }

  $effect(() => {
    if (open) {
      editing = canWrite && initialEditing;
      status = entry.status;
      vendor = entry.vendor ?? '';
      product = entry.product ?? '';
      notes = entry.notes ?? '';
      metadataRows = defaultRowsFor(entry.metadataFields, entry.metadata);
    }
  });

  function metadataPayload() {
    return Object.fromEntries(
      metadataRows
        .map((row) => [row.key.trim(), row.value.trim()] as const)
        .filter(([key, value]) => key && value)
    );
  }

  function addMetadataField() {
    metadataRows = [
      ...metadataRows,
      {
        key: '',
        label: 'Custom field',
        type: 'string',
        required: false,
        helpText: null,
        value: '',
      },
    ];
  }

  const missingRequiredDetails = $derived(
    status === 'not_used'
      ? []
      : metadataRows.filter((row) => row.required && !row.value.trim()).map((row) => row.label)
  );

  const stackDisplay = $derived.by(() => {
    if (entry.status === 'not_used') return 'Not used';
    const parts = [entry.vendor, entry.product].filter(Boolean);
    if (parts.length) return parts.join(' · ');
    return relationshipLabels[entry.status];
  });

  const visibleMetadata = $derived(
    Object.entries(entry.metadata ?? {}).filter(([, value]) => value)
  );

  const save = createMutation(() => ({
    mutationFn: () =>
      trpc.siteProfile.upsertStackEntry.mutate({
        siteId,
        categoryKey: entry.categoryKey,
        vendor: status === 'not_used' ? null : vendor || null,
        product: status === 'not_used' ? null : product || null,
        status,
        notes: notes || null,
        metadata: metadataPayload(),
        source: 'manual',
        origin: 'user',
      }),
    onSuccess: () => {
      editing = false;
      open = false;
      toast.success('Stack entry saved');
      qc.invalidateQueries({ queryKey: ['sites.profileById', siteId] });
    },
    onError: (e: unknown) => toast.error(e instanceof Error ? e.message : 'Save failed'),
  }));

  const clear = createMutation(() => ({
    mutationFn: () =>
      trpc.siteProfile.deleteStackEntry.mutate({ siteId, categoryKey: entry.categoryKey }),
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
  <Dialog.Content class="sm:max-w-[640px]">
    <Dialog.Header>
      <Dialog.Title>{entry.categoryLabel}</Dialog.Title>
      <Dialog.Description>
        {editing
          ? 'Document the vendor, ownership, caveats, and operational details for this service.'
          : 'Review the documented vendor, ownership, caveats, and operational details.'}
      </Dialog.Description>
    </Dialog.Header>
    <Separator />
    {#if !editing}
      <div class="grid max-h-[70vh] gap-4 overflow-y-auto p-4">
        <div class="grid gap-1">
          <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Relationship
          </div>
          <div class="text-sm">{relationshipLabels[entry.status]}</div>
        </div>
        <div class="grid gap-1">
          <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Platform
          </div>
          <div class="text-sm">{stackDisplay}</div>
        </div>
        {#if entry.notes}
          <div class="grid gap-1">
            <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Caveats / notes
            </div>
            <div class="whitespace-pre-wrap text-sm">{entry.notes}</div>
          </div>
        {/if}
        {#if visibleMetadata.length}
          <div class="grid gap-2">
            <div class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              Details
            </div>
            <dl class="grid gap-2">
              {#each visibleMetadata as [key, value] (key)}
                <div class="grid grid-cols-[140px_minmax(0,1fr)] gap-3 text-sm">
                  <dt class="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                    {entry.metadataFields.find((field) => field.key === key)?.label ??
                      key.replace(/_/g, ' ')}
                  </dt>
                  <dd class="min-w-0 break-words">{value}</dd>
                </div>
              {/each}
            </dl>
          </div>
        {/if}
      </div>
    {:else}
      <div class="grid max-h-[70vh] gap-4 overflow-y-auto p-4">
        <div class="grid gap-1.5">
          <Label>Relationship</Label>
          <Select.Root
            type="single"
            value={status}
            onValueChange={(v) => v && (status = v as Status)}
          >
            <Select.Trigger>{relationshipLabels[status]}</Select.Trigger>
            <Select.Content>
              <Select.Item value="msp_managed">Managed by us</Select.Item>
              <Select.Item value="client_managed">Managed by client</Select.Item>
              <Select.Item value="vendor_managed">Managed by vendor</Select.Item>
              <Select.Item value="planned">Planned</Select.Item>
              <Select.Item value="not_used">Not used</Select.Item>
              <Select.Item value="unknown">Unknown</Select.Item>
            </Select.Content>
          </Select.Root>
        </div>

        {#if status !== 'not_used'}
          <div class="grid grid-cols-2 gap-3">
            <div class="grid gap-1.5">
              <Label for="stack-vendor">Vendor</Label>
              <Input id="stack-vendor" bind:value={vendor} placeholder="Vendor name" />
            </div>
            <div class="grid gap-1.5">
              <Label for="stack-product">Product</Label>
              <Input id="stack-product" bind:value={product} placeholder="Product name" />
            </div>
          </div>
        {/if}

        <div class="grid gap-1.5">
          <Label for="stack-notes">Caveats / notes</Label>
          <Textarea
            id="stack-notes"
            bind:value={notes}
            rows={3}
            placeholder="Contract notes, exceptions, escalation path, or site-specific caveats"
          />
        </div>

        {#if status !== 'not_used'}
          <div class="grid gap-2">
            <div class="flex items-center justify-between gap-2">
              <Label>Details</Label>
              <button
                type="button"
                class="text-xs text-muted-foreground hover:text-foreground"
                onclick={addMetadataField}
              >
                Add field
              </button>
            </div>
            <div class="grid gap-2">
              {#each metadataRows as row, i (`${row.key}-${i}`)}
                <div class="grid grid-cols-[minmax(120px,0.45fr)_minmax(0,1fr)] gap-2">
                  <div class="grid gap-1">
                    <Input
                      bind:value={row.label}
                      placeholder="Label"
                      readonly={entry.metadataFields.some((field) => field.key === row.key)}
                      oninput={() => {
                        if (!row.key) row.key = row.label.toLowerCase().replace(/[^a-z0-9]+/g, '_');
                      }}
                    />
                    {#if entry.metadataFields.find((field) => field.key === row.key)?.required}
                      <span class="font-mono text-[10px] uppercase tracking-wider text-warning">
                        required
                      </span>
                    {/if}
                  </div>
                  <div class="grid gap-1">
                    <Input
                      bind:value={row.value}
                      type={row.type === 'number' ? 'number' : row.type === 'url' ? 'url' : 'text'}
                      placeholder={row.helpText || row.label || 'Value'}
                    />
                    {#if row.helpText}
                      <span class="text-[11px] text-muted-foreground">{row.helpText}</span>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
            {#if missingRequiredDetails.length}
              <p class="text-xs text-warning">
                Missing required details: {missingRequiredDetails.join(', ')}
              </p>
            {/if}
          </div>
        {/if}
      </div>
    {/if}

    <Dialog.Footer>
      {#if canDelete}
        <Button variant="destructive" onclick={() => clear.mutate()} disabled={clear.isPending}>
          Clear
        </Button>
      {/if}
      <div class="flex-1"></div>
      {#if editing}
        <Button variant="ghost" onclick={() => (editing = false)}>Cancel</Button>
        <Button
          onclick={() => save.mutate()}
          disabled={save.isPending || !!missingRequiredDetails.length || !canWrite}
        >
          Save
        </Button>
      {:else}
        <Button variant="ghost" onclick={() => (open = false)}>Close</Button>
        {#if canWrite}
          <Button onclick={() => (editing = true)}>Edit</Button>
        {/if}
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
