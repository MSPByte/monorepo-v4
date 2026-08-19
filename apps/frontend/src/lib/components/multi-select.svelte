<script lang="ts">
  import { Check, ChevronDown } from '@lucide/svelte';
  import { cn } from '$lib/utils';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Spinner } from '$lib/components/ui/spinner/index.js';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as Command from '$lib/components/ui/command/index.js';

  type Option = {
    value: string;
    label: string;
    // Optional muted line rendered under the label — e.g. availability count
    // for a license SKU, mailbox for an identity.
    subLabel?: string;
    disabled?: boolean;
  };

  let {
    options = [],
    selected = $bindable([]),
    placeholder = 'Select items...',
    maxDisplay = 1,
    searchPlaceholder = 'Search...',
    class: className = '',
    disabled = false,
    loading = false,
    onchange = (_selected: string[]) => {},
    onsearch,
  }: {
    options: Option[];
    selected?: string[];
    placeholder?: string;
    maxDisplay?: number;
    searchPlaceholder?: string;
    class?: string;
    disabled?: boolean;
    loading?: boolean;
    onchange?: (selected: string[]) => void;
    onsearch?: (query: string) => void;
  } = $props();

  let open = $state(false);
  let search = $state('');

  $effect(() => {
    if (!open) {
      search = '';
    }
  });

  $effect(() => {
    if (onsearch) onsearch(search);
  });

  // When the caller drives filtering server-side (onsearch), we render
  // whatever comes back untouched and just re-pin selected items on top.
  const filteredOptions = $derived.by(() => {
    if (onsearch) {
      const selectedSet = new Set(selected);
      const inList = new Set(options.map((o) => o.value));
      const missing = selected.filter((s) => !inList.has(s));
      // Missing selected items don't have labels available; show them as raw
      // values so the user can still remove them.
      const missingOpts: Option[] = missing.map((v) => ({ value: v, label: v }));
      const selectedMatches = options.filter((o) => selectedSet.has(o.value));
      const unselectedMatches = options.filter((o) => !selectedSet.has(o.value));
      return [...selectedMatches, ...missingOpts, ...unselectedMatches];
    }
    const needle = search.toLowerCase();
    const matches = options.filter(
      (opt) =>
        opt.label.toLowerCase().includes(needle) ||
        (opt.subLabel?.toLowerCase().includes(needle) ?? false)
    );
    const selectedMatches = matches.filter((o) => selected.includes(o.value));
    const unselectedMatches = matches.filter((o) => !selected.includes(o.value));
    return [...selectedMatches, ...unselectedMatches];
  });

  const selectedOptions = $derived(options.filter((opt) => selected.includes(opt.value)));

  const toggleOption = (value: string) => {
    if (selected.includes(value)) {
      selected = selected.filter((v) => v !== value);
    } else {
      selected = [...selected, value];
    }
    onchange?.(selected);
  };

  const clearAll = () => {
    selected = [];
    onchange?.(selected);
  };

  const displayText = $derived.by(() => {
    if (selectedOptions.length === 0 && selected.length === 0) return placeholder;
    const total = selected.length;
    if (selectedOptions.length <= maxDisplay) {
      const labels = selectedOptions.map((o) => o.label).join(', ');
      const missing = total - selectedOptions.length;
      return missing > 0 ? `${labels || total + ' selected'}` : labels;
    }
    return `${total} selected`;
  });
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button
        {...props}
        variant="outline"
        role="combobox"
        aria-expanded={open}
        class={cn('w-full justify-between overflow-hidden', className)}
        {disabled}
      >
        <span class={cn('truncate', selected.length === 0 && 'text-muted-foreground')}>
          {displayText}
        </span>
        <ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    class="w-[min(32rem,calc(100vw-2rem))] min-w-[22rem] p-0"
    align="start"
    sideOffset={6}
  >
    <Command.Root shouldFilter={false}>
      <Command.Input placeholder={searchPlaceholder} bind:value={search} />
      {#if loading && filteredOptions.length === 0}
        <div class="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
          <Spinner class="size-3.5" />
          <span>Loading…</span>
        </div>
      {:else}
        <Command.Empty>No results found.</Command.Empty>
        <Command.Group class="max-h-64 overflow-auto">
          {#each filteredOptions as option}
            <Command.Item
              value={option.value}
              onSelect={() => !option.disabled && toggleOption(option.value)}
              disabled={option.disabled}
              class={cn(option.disabled && 'opacity-50 cursor-not-allowed')}
            >
              <div
                class={cn(
                  'mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-sm border border-primary',
                  selected.includes(option.value)
                    ? 'bg-primary text-primary-foreground'
                    : 'opacity-50 [&_svg]:invisible'
                )}
              >
                <Check class="h-4 w-4" />
              </div>
              <div class="flex min-w-0 flex-col">
                <span class="whitespace-normal leading-5">{option.label}</span>
                {#if option.subLabel}
                  <span class="whitespace-normal text-xs text-muted-foreground"
                    >{option.subLabel}</span
                  >
                {/if}
              </div>
            </Command.Item>
          {/each}
          {#if loading && filteredOptions.length > 0}
            <div class="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <Spinner class="size-3" />
              <span>Refreshing…</span>
            </div>
          {/if}
        </Command.Group>
        {#if selected.length > 0}
          <Command.Separator />
          <Command.Group>
            <Command.Item onSelect={clearAll} class="justify-center text-center">
              Clear all
            </Command.Item>
          </Command.Group>
        {/if}
      {/if}
    </Command.Root>
  </Popover.Content>
</Popover.Root>
