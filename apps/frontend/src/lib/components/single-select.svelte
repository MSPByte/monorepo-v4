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
    // for a license SKU, integration id for a tenant.
    subLabel?: string;
    // Groups make a shared picker understandable when options originate from
    // different platform domains, such as MSPByte and Microsoft 365.
    group?: string;
    disabled?: boolean;
  };

  let {
    options = [],
    selected = $bindable<string | undefined>(undefined),
    placeholder = 'Select item...',
    searchPlaceholder = 'Search...',
    class: className = '',
    disabled = false,
    onchange = (_selected: string) => {},
    onsearch,
    loading = false,
    disableSort = false,
    allowClear = true,
    'aria-label': ariaLabel = undefined,
  }: {
    options: Option[];
    selected?: string;
    placeholder?: string;
    searchPlaceholder?: string;
    class?: string;
    disabled?: boolean;
    onchange?: (selected: string) => void;
    onsearch?: (query: string) => void;
    loading?: boolean;
    disableSort?: boolean;
    allowClear?: boolean;
    'aria-label'?: string;
  } = $props();

  let open = $state(false);
  let search = $state('');

  $effect(() => {
    if (!open) {
      search = '';
    }
  });

  $effect(() => {
    if (onsearch) {
      onsearch(search);
    }
  });

  const filteredOptions = $derived.by(() => {
    const sort = (options: Option[]) => {
      if (disableSort) return options;
      return [...options].sort((a, b) => a.label.localeCompare(b.label));
    };

    if (onsearch) {
      // Server-side filtering — prepend selected item if not in results
      const current = options.find((o) => o.value === selected);
      if (current && !options.some((o) => o.value === selected)) {
        return [current, ...sort(options)];
      }
      return sort(options);
    }
    const current = options.find((o) => o.value === selected);
    return current
      ? [
          current,
          ...sort(options).filter(
            (opt) =>
              opt.value !== selected && opt.label.toLowerCase().includes(search.toLowerCase())
          ),
        ]
      : sort(options).filter((opt) => opt.label.toLowerCase().includes(search.toLowerCase()));
  });

  const groupedOptions = $derived.by(() => {
    const groups = new Map<string, Option[]>();
    for (const option of filteredOptions) {
      const group = option.group ?? '';
      groups.set(group, [...(groups.get(group) ?? []), option]);
    }
    return [...groups.entries()];
  });

  const selectOption = (value: string) => {
    if (selected === value && allowClear) {
      selected = undefined;
    } else {
      selected = value;
    }
    onchange?.(selected ?? '');
    open = false;
  };

  const displayText = $derived.by(() => {
    if (!selected) return placeholder;
    const option = options.find((o) => o.value === selected);
    return option?.label ?? placeholder;
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
        aria-label={ariaLabel}
        class={cn('w-full justify-between overflow-hidden', className)}
        {disabled}
      >
        <span class="truncate">{displayText}</span>
        <ChevronDown class="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content
    class="w-[min(30rem,calc(100vw-2rem))] min-w-[20rem] p-0"
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
          {#each groupedOptions as [group, groupOptions]}
            {#if group}
              <div class="px-2 pb-1 pt-2 font-mono text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                {group}
              </div>
            {/if}
            {#each groupOptions as option}
              <Command.Item
                value={option.value}
                onSelect={() => !option.disabled && selectOption(option.value)}
                disabled={option.disabled}
                class={cn(option.disabled && 'opacity-50 cursor-not-allowed')}
              >
                <div
                  class={cn(
                    'mr-2 flex h-4 w-4 shrink-0 items-center justify-center rounded-full border border-primary',
                    selected === option.value
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
          {/each}
          {#if loading && filteredOptions.length > 0}
            <div class="flex items-center justify-center gap-2 py-2 text-xs text-muted-foreground">
              <Spinner class="size-3" />
              <span>Refreshing…</span>
            </div>
          {/if}
        </Command.Group>
      {/if}
    </Command.Root>
  </Popover.Content>
</Popover.Root>
