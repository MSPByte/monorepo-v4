<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import type { OverrideType } from '../_wiki-utils.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';
  import RichEditor from '../_rich-editor.svelte';

  import Lock from '@lucide/svelte/icons/lock';
  import Save from '@lucide/svelte/icons/save';
  import Send from '@lucide/svelte/icons/send';
  import X from '@lucide/svelte/icons/x';

  const OVERRIDE_TYPES: { value: OverrideType; label: string }[] = [
    { value: 'addendum', label: 'Addendum' },
    { value: 'note', label: 'Note' },
    { value: 'replacement', label: 'Replacement' }
  ];

  const TYPE_COLORS: Record<OverrideType, string> = {
    addendum: 'oklch(0.62 0.188 259.8)',
    note: 'oklch(0.737 0.153 74.2)',
    replacement: 'oklch(0.637 0.208 25.33)'
  };

  interface OverrideData {
    id: string;
    siteId: string;
    siteName: string;
    type: string;
    title: string;
    contentJson?: unknown;
    contentText: string;
  }

  interface Props {
    override: OverrideData | null;
    articleId: string;
    onClose: () => void;
    onSave: (data: {
      id?: string;
      site_id: string;
      type: OverrideType;
      title: string;
      contentJson: unknown;
      contentText: string;
    }) => void;
  }

  const { override, articleId, onClose, onSave }: Props = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const sitesQuery = createQuery(() => ({
    queryKey: ['sites.list'],
    queryFn: () => trpc.sites.list.query()
  }));

  const sites = $derived(sitesQuery.data ?? []);

  const isNew = $derived(override === null);

  let title = $state(override?.title ?? '');
  let siteId = $state(override?.siteId ?? '');
  let overrideType = $state<OverrideType>((override?.type as OverrideType) ?? 'addendum');
  let contentHtml = $state('');
  let contentJson = $state<Record<string, unknown> | undefined>(
    override?.contentJson as Record<string, unknown> | undefined
  );
  let contentText = $state(override?.contentText ?? '');
  let isDirty = $state(false);
  let isSaving = $state(false);

  function markDirty() {
    isDirty = true;
  }

  async function handleSave() {
    if (!siteId || !title.trim()) return;
    isSaving = true;
    onSave({
      id: override?.id,
      site_id: siteId,
      type: overrideType,
      title: title.trim(),
      contentJson: contentJson ?? { type: 'doc', content: [] },
      contentText
    });
    isSaving = false;
    isDirty = false;
  }
</script>

<div class="flex flex-col size-full overflow-hidden">
  <div class="flex items-center gap-2 px-4 py-2 border-b bg-card/60 shrink-0">
    <div class="flex items-center gap-2 flex-1 min-w-0">
      <div class="w-44 shrink-0">
        <SingleSelect
          bind:selected={siteId}
          options={sites.map((s) => ({ label: s.name, value: s.id }))}
          disabled={!isNew}
        />
      </div>
      <div class="flex gap-1 shrink-0">
        {#each OVERRIDE_TYPES as t (t.value)}
          <button
            onclick={() => {
              overrideType = t.value;
              markDirty();
            }}
            class="px-2 py-0.5 rounded text-xs border transition-colors"
            style={overrideType === t.value
              ? `background-color: ${TYPE_COLORS[t.value]}18; color: ${TYPE_COLORS[t.value]}; border-color: ${TYPE_COLORS[t.value]}40`
              : 'border-color: var(--border); color: var(--muted-foreground)'}
          >
            {t.label}
          </button>
        {/each}
      </div>
    </div>

    <div class="flex items-center gap-1.5 shrink-0">
      {#if isDirty}
        <span class="text-xs text-warning hidden sm:block">Unsaved</span>
      {/if}
      <Button variant="ghost" size="sm" class="gap-1.5" disabled={isSaving} onclick={handleSave}>
        <Save class="size-3.5" />
        {isSaving ? 'Saving…' : 'Save Draft'}
      </Button>
      <Button
        variant="default"
        size="sm"
        class="gap-1.5"
        disabled={!siteId || !title.trim()}
        onclick={handleSave}
      >
        <Send class="size-3.5" />
        {isNew ? 'Publish' : 'Update'}
      </Button>
      <Button variant="ghost" size="icon-sm" onclick={onClose} title="Close editor">
        <X class="size-4" />
      </Button>
    </div>
  </div>

  <div class="px-4 pt-3 pb-2 shrink-0 border-b">
    <Input
      bind:value={title}
      placeholder="Override title…"
      oninput={markDirty}
      class="text-base font-semibold h-auto p-1 border-0 border-b border-border/50 rounded-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-primary/50 placeholder:text-muted-foreground/35"
    />
  </div>

  <div class="flex flex-col flex-1 overflow-hidden">
    <RichEditor
      bind:html={contentHtml}
      bind:json={contentJson}
      bind:text={contentText}
      onchange={markDirty}
      class="min-h-full"
    />
  </div>
</div>
