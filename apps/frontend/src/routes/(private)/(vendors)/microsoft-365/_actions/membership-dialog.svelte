<script lang="ts">
  import { cn } from '$lib/utils';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';
  import PlusIcon from '@lucide/svelte/icons/plus';
  import MinusIcon from '@lucide/svelte/icons/minus';

  type Option = { value: string; label: string; disabled?: boolean };
  type Mode = 'add' | 'remove';

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    title: string;
    subjectLabel: string;
    itemNoun: string;
    itemNounPlural: string;
    addOptions: Option[];
    removeOptions: Option[];
    loadingOptions?: boolean;
    submitting: boolean;
    // Additional loading label to show above the picker.
    hint?: string;
    // Called on submit — the caller executes the appropriate mutation.
    onSubmit: (mode: Mode, selected: string[]) => Promise<void> | void;
  }

  let {
    open,
    onOpenChange,
    title,
    subjectLabel,
    itemNoun,
    itemNounPlural,
    addOptions,
    removeOptions,
    loadingOptions = false,
    submitting,
    hint,
    onSubmit
  }: Props = $props();

  let mode = $state<Mode>('add');
  let selected = $state<string[]>([]);

  $effect(() => {
    if (open) {
      mode = 'add';
      selected = [];
    }
  });

  $effect(() => {
    // Clear selection when the mode changes — options differ per mode.
    void mode;
    selected = [];
  });

  const currentOptions = $derived(mode === 'add' ? addOptions : removeOptions);
  const submitLabel = $derived.by(() => {
    const verb = mode === 'add' ? 'Assign' : 'Remove';
    return selected.length > 0 ? `${verb} ${selected.length}` : verb;
  });
  const emptyMsg = $derived.by(() => {
    if (loadingOptions) return null;
    if (mode === 'add') {
      return currentOptions.length === 0
        ? `No ${itemNounPlural} available to assign.`
        : null;
    }
    return currentOptions.length === 0
      ? `${subjectLabel} isn't assigned to any ${itemNounPlural}.`
      : null;
  });
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => {
    if (submitting) return;
    onOpenChange(next);
  }}
>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title class="flex items-center gap-2">{title}</Dialog.Title>
      <Dialog.Description>
        {#if mode === 'add'}
          Assign {itemNounPlural} to <span class="font-medium text-foreground">{subjectLabel}</span>.
        {:else}
          Remove {itemNounPlural} from <span class="font-medium text-foreground">{subjectLabel}</span>.
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>

    <div class="grid gap-4">
      <!-- Segmented control -->
      <div
        role="tablist"
        class="inline-flex items-center gap-0.5 rounded-md border bg-muted/40 p-0.5 self-start w-full sm:w-fit"
      >
        {#each ['add', 'remove'] as const as m}
          {@const active = mode === m}
          <button
            type="button"
            role="tab"
            aria-selected={active}
            disabled={submitting}
            onclick={() => (mode = m)}
            class={cn(
              'inline-flex flex-1 sm:flex-initial items-center justify-center gap-1.5 rounded-[calc(var(--radius)-2px)] px-3 py-1.5 text-xs font-medium transition-colors',
              active
                ? 'bg-background text-foreground shadow-sm ring-1 ring-border/60'
                : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {#if m === 'add'}
              <PlusIcon class="size-3.5" />
              Assign
            {:else}
              <MinusIcon class="size-3.5" />
              Remove
            {/if}
          </button>
        {/each}
      </div>

      <div class="grid gap-2">
        <div class="flex items-center justify-between text-xs text-muted-foreground">
          <span class="font-medium">
            {mode === 'add' ? `Available ${itemNounPlural}` : `Assigned ${itemNounPlural}`}
          </span>
          {#if hint}
            <span>{hint}</span>
          {/if}
        </div>

        {#if loadingOptions}
          <div class="h-9 bg-muted/50 rounded-md animate-pulse"></div>
        {:else if emptyMsg}
          <div
            class="rounded-md border border-dashed p-3 text-center text-xs text-muted-foreground"
          >
            {emptyMsg}
          </div>
        {:else}
          <MultiSelect
            options={currentOptions}
            bind:selected
            placeholder={`Select ${itemNounPlural}...`}
            searchPlaceholder={`Search ${itemNounPlural}...`}
            maxDisplay={2}
            disabled={submitting}
          />
        {/if}
      </div>
    </div>


    </Dialog.Body><Dialog.Footer>
      <Button type="button" variant="ghost" disabled={submitting} onclick={() => onOpenChange(false)}>
        Cancel
      </Button>
      <Button
        type="button"
        variant={mode === 'remove' ? 'destructive' : 'default'}
        disabled={submitting || selected.length === 0}
        onclick={() => onSubmit(mode, selected)}
      >
        {#if submitting}
          <LoaderCircleIcon class="size-4 animate-spin" />
        {/if}
        {submitLabel} {selected.length === 1 ? itemNoun : itemNounPlural}
      </Button>
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
