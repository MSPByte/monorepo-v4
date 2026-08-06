<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as Command from '$lib/components/ui/command/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Check, ChevronsUpDown } from '@lucide/svelte';

  type EntityType = 'integration_link' | 'm365_identity' | 'm365_group' | 'm365_license';

  type Props = {
    entityType: EntityType;
    integrationLinkId?: string;
    integrationId?: string;
    // Single: string | null; Multi: string[]
    value: string | string[] | null;
    onValueChange: (value: string | string[] | null) => void;
    multiple?: boolean;
    placeholder?: string;
    disabled?: boolean;
  };

  let {
    entityType,
    integrationLinkId,
    integrationId,
    value,
    onValueChange,
    multiple = false,
    placeholder = 'Choose one…',
    disabled = false,
  }: Props = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const options = createQuery(() => ({
    queryKey: [
      'packages.entityOptions',
      entityType,
      integrationLinkId ?? null,
      integrationId ?? null,
    ],
    queryFn: () =>
      trpc.packages.entityOptions.query({
        entityType,
        integrationLinkId,
        integrationId,
      }),
    staleTime: 30_000,
  }));

  let open = $state(false);

  const selectedSet = $derived(
    multiple
      ? new Set(Array.isArray(value) ? value : [])
      : new Set(typeof value === 'string' && value ? [value] : []),
  );

  const selectedLabels = $derived.by(() => {
    const opts = options.data ?? [];
    return opts.filter((o) => selectedSet.has(o.id)).map((o) => o.label);
  });

  const buttonLabel = $derived(() => {
    if (selectedLabels.length === 0) return placeholder;
    if (multiple) {
      if (selectedLabels.length === 1) return selectedLabels[0]!;
      return `${selectedLabels[0]} +${selectedLabels.length - 1}`;
    }
    return selectedLabels[0]!;
  });

  function toggle(id: string) {
    if (multiple) {
      const next = new Set(Array.isArray(value) ? value : []);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      onValueChange(Array.from(next));
    } else {
      onValueChange(id);
      open = false;
    }
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        {disabled}
        class="w-full justify-between font-normal"
      >
        <span class={selectedLabels.length === 0 ? 'text-muted-foreground' : ''}
          >{buttonLabel()}</span
        >
        <ChevronsUpDown class="ml-2 size-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-[var(--bits-popover-anchor-width)] p-0" align="start">
    <Command.Root>
      <Command.Input placeholder="Search…" />
      <Command.List>
        {#if options.isLoading}
          <Command.Loading>Loading…</Command.Loading>
        {:else if (options.data ?? []).length === 0}
          <Command.Empty>Nothing to show.</Command.Empty>
        {:else}
          <Command.Group>
            {#each options.data ?? [] as opt (opt.id)}
              <Command.Item
                value={`${opt.label} ${opt.subLabel ?? ''} ${opt.id}`}
                onSelect={() => toggle(opt.id)}
              >
                <Check
                  class={selectedSet.has(opt.id) ? 'mr-2 size-4' : 'mr-2 size-4 opacity-0'}
                />
                <div class="flex flex-col">
                  <span>{opt.label}</span>
                  {#if opt.subLabel}
                    <span class="text-xs text-muted-foreground">{opt.subLabel}</span>
                  {/if}
                </div>
              </Command.Item>
            {/each}
          </Command.Group>
        {/if}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
