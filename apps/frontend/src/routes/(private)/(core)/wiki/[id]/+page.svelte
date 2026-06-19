<script lang="ts">
  import '../create/[id]/_editor.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import type { OverrideType } from '../_wiki-utils.js';
  import { getContextPath } from '../_wiki-utils.js';
  import { renderContentHtml } from '../_render-content.js';
  import OverrideEditor from './_override-editor.svelte';
  import KbRefPopover from '../_kb-ref-popover.svelte';
  import ArticleOutline from '../_article-outline.svelte';

  import Button from '$lib/components/ui/button/button.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';

  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import ChevronRight from '@lucide/svelte/icons/chevron-right';
  import ChevronDown from '@lucide/svelte/icons/chevron-down';
  import Pencil from '@lucide/svelte/icons/pencil';
  import X from '@lucide/svelte/icons/x';
  import Plus from '@lucide/svelte/icons/plus';
  import Search from '@lucide/svelte/icons/search';
  import Trash2 from '@lucide/svelte/icons/trash-2';
  import Globe from '@lucide/svelte/icons/globe';
  import GripHorizontal from '@lucide/svelte/icons/grip-horizontal';
  import Clock from '@lucide/svelte/icons/clock';
  import FileText from '@lucide/svelte/icons/file-text';
  import FolderOpen from '@lucide/svelte/icons/folder-open';
  import Link from '@lucide/svelte/icons/link';
  import Archive from '@lucide/svelte/icons/archive';
  import SlidersHorizontal from '@lucide/svelte/icons/sliders-horizontal';
  import Maximize2 from '@lucide/svelte/icons/maximize-2';
  import Minimize2 from '@lucide/svelte/icons/minimize-2';
  import Shield from '@lucide/svelte/icons/shield';
  import { formatStringProper } from '$lib/utils/format.js';
  import { DotIcon } from '@lucide/svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import FadeIn from '$lib/components/transition/fade-in.svelte';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const articleId = $derived(page.params.id ?? '');

  const articleQuery = createQuery(() => ({
    queryKey: ['wiki.articles.get', articleId],
    queryFn: () => trpc.wiki.articles.get.query({ id: articleId }),
    enabled: !!articleId,
  }));

  const contextsQuery = createQuery(() => ({
    queryKey: ['wiki.contexts.list'],
    queryFn: () => trpc.wiki.contexts.list.query(),
  }));

  const tagsQuery = createQuery(() => ({
    queryKey: ['wiki.tags.list'],
    queryFn: () => trpc.wiki.tags.list.query(),
  }));

  const allContexts = $derived(contextsQuery.data ?? []);
  const allTags = $derived(tagsQuery.data ?? []);
  const article = $derived(articleQuery.data ?? null);

  const primaryContextPath = $derived(
    article ? getContextPath(article.primaryContextId, allContexts) : []
  );

  function processKbRefs(html: string): string {
    return html.replace(
      /\bKB\d{3,4}\b/g,
      (match) => `<span class="kb-ref" data-kb-id="${match}">${match}</span>`
    );
  }

  const overrides = $derived(article?.overrides ?? []);
  const versions = $derived(article?.versions ?? []);
  const hasOpenDraft = $derived(Boolean(article?.draft));
  let selectedVersionId = $state<string | null>(null);
  let articleContentEl = $state<HTMLElement | null>(null);
  let metaDialogOpen = $state(false);
  let metaPrimaryContextId = $state('');
  let metaLinkedContextIds = $state<string[]>([]);
  let metaTagIds = $state<string[]>([]);

  const selectedVersion = $derived(
    selectedVersionId
      ? (versions.find((version) => version.id === selectedVersionId) ?? null)
      : null
  );
  const selectedVersionQuery = createQuery(() => ({
    queryKey: ['wiki.versions.get', articleId, selectedVersionId],
    queryFn: () => trpc.wiki.versions.get.query({ id: selectedVersionId!, articleId }),
    enabled: Boolean(articleId && selectedVersionId),
  }));
  const selectedVersionContent = $derived(selectedVersionQuery.data ?? null);
  const displayedContentJson = $derived(
    selectedVersionId ? selectedVersionContent?.contentJson : article?.contentJson
  );
  const displayedBody = $derived.by(() => {
    if (!displayedContentJson) return '';
    try {
      const html = renderContentHtml(displayedContentJson as any);
      return processKbRefs(html);
    } catch {
      return '<p>Error rendering content</p>';
    }
  });

  $effect(() => {
    if (selectedVersionId && !versions.some((version) => version.id === selectedVersionId)) {
      selectedVersionId = null;
    }
  });

  // Override panel state
  type OverrideItem = (typeof overrides)[number];
  let selectedOverride = $state<OverrideItem | null>(null);
  let isEditingOverride = $state(false);
  let isNewOverride = $state(false);
  let overridePanelHeight = $state(360);
  let overridePanelExpanded = $state(false);
  let panelSearch = $state('');
  let openSections = $state({
    contexts: true,
    overrides: true,
    related: true,
    history: true,
    permissions: true,
  });

  const q = $derived(panelSearch.toLowerCase());
  const filteredOverrides = $derived(
    q
      ? overrides.filter(
          (o) =>
            o.title.toLowerCase().includes(q) ||
            o.siteName.toLowerCase().includes(q) ||
            o.type.includes(q)
        )
      : overrides
  );
  const filteredVersions = $derived(
    q
      ? versions.filter(
          (v) =>
            (v.createdBy?.name ?? '').toLowerCase().includes(q) ||
            (v.changeNote ?? '').toLowerCase().includes(q) ||
            String(v.versionNumber).includes(q)
        )
      : versions
  );

  const OVERRIDE_TYPE_COLORS: Record<string, string> = {
    addendum: 'oklch(0.62 0.188 259.8)',
    note: 'oklch(0.737 0.153 74.2)',
    replacement: 'oklch(0.637 0.208 25.33)',
  };

  const contextOptions = $derived(
    allContexts.map((c) => ({
      label: getContextPath(c.id, allContexts)
        .map((ctx) => ctx.name)
        .join(' / '),
      value: c.id,
    }))
  );
  const linkedContextOptions = $derived(
    contextOptions.filter((option) => option.value !== metaPrimaryContextId)
  );
  const tagOptions = $derived(allTags.map((tag) => ({ label: tag.name, value: tag.id })));

  const removeArticleMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.wiki.articles.remove.mutate({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
      goto('/wiki');
    },
  }));

  const updateMetaMut = createMutation(() => ({
    mutationFn: (input: {
      id: string;
      primaryContextId: string;
      linkedContextIds: string[];
      tagIds: string[];
    }) => trpc.wiki.articles.updateMeta.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles.get', articleId] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
      metaDialogOpen = false;
    },
  }));

  const archiveArticleMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.wiki.articles.archive.mutate({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles.get', articleId] });
    },
  }));

  const createOverrideMut = createMutation(() => ({
    mutationFn: (input: {
      articleId: string;
      siteId: string;
      type: OverrideType;
      title: string;
      contentJson: unknown;
      contentText: string;
    }) => trpc.wiki.overrides.create.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles.get', articleId] });
      isEditingOverride = false;
      isNewOverride = false;
    },
  }));

  const updateOverrideMut = createMutation(() => ({
    mutationFn: (input: {
      id: string;
      type?: OverrideType;
      title?: string;
      contentJson?: unknown;
      contentText?: string;
    }) => trpc.wiki.overrides.update.mutate(input),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles.get', articleId] });
      isEditingOverride = false;
    },
  }));

  const removeOverrideMut = createMutation(() => ({
    mutationFn: (id: string) => trpc.wiki.overrides.remove.mutate({ id }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles.get', articleId] });
      closeOverridePanel();
    },
  }));

  function selectOverride(o: OverrideItem) {
    selectedOverride = o;
    isEditingOverride = false;
    isNewOverride = false;
  }

  function openNewOverride() {
    selectedOverride = null;
    isNewOverride = true;
    isEditingOverride = true;
  }

  function editSelectedOverride() {
    isEditingOverride = true;
    isNewOverride = false;
  }

  function closeOverridePanel() {
    selectedOverride = null;
    isEditingOverride = false;
    isNewOverride = false;
  }

  function openMetaDialog() {
    if (!article) return;
    metaPrimaryContextId = article.primaryContextId;
    metaLinkedContextIds = article.linkedContexts.map((ctx) => ctx.id);
    metaTagIds = article.tags.map((tag) => tag.id);
    metaDialogOpen = true;
  }

  function saveMeta() {
    if (!article || !metaPrimaryContextId) return;

    updateMetaMut.mutate({
      id: article.id,
      primaryContextId: metaPrimaryContextId,
      linkedContextIds: metaLinkedContextIds.filter((id) => id !== metaPrimaryContextId),
      tagIds: metaTagIds,
    });
  }

  function handleOverrideSave(data: {
    id?: string;
    site_id: string;
    type: OverrideType;
    title: string;
    contentJson: unknown;
    contentText: string;
  }) {
    if (data.id) {
      updateOverrideMut.mutate({
        id: data.id,
        type: data.type,
        title: data.title,
        contentJson: data.contentJson,
        contentText: data.contentText,
      });
    } else {
      createOverrideMut.mutate({
        articleId,
        siteId: data.site_id,
        type: data.type,
        title: data.title,
        contentJson: data.contentJson,
        contentText: data.contentText,
      });
    }
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }

  function toggleSection(key: keyof typeof openSections) {
    openSections[key] = !openSections[key];
  }

  function startOverridePanelResize(e: PointerEvent) {
    e.preventDefault();
    overridePanelExpanded = false;
    const startY = e.clientY;
    const startHeight = overridePanelHeight;

    function onPointerMove(moveEvent: PointerEvent) {
      const next = startHeight + (startY - moveEvent.clientY);
      const max = Math.max(360, window.innerHeight - 160);
      overridePanelHeight = Math.min(Math.max(next, 280), max);
    }

    function onPointerUp() {
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    }

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  }

  function renderOverrideHtml(o: OverrideItem): string {
    try {
      const html = renderContentHtml(o.contentJson as any);
      return processKbRefs(html);
    } catch {
      return '<p>Error rendering content</p>';
    }
  }
</script>

{#if article}
  <FadeIn class="flex flex-col size-full overflow-hidden">
    <div
      class="flex items-center justify-between px-4 py-2 border-b bg-card/70 backdrop-blur shrink-0 gap-2"
    >
      <div class="flex items-center gap-2 min-w-0">
        <Button
          variant="ghost"
          size="icon-sm"
          href={`/wiki/category/${article.primaryContextId}`}
          title="Back to wiki"
        >
          <ArrowLeft class="size-4" />
        </Button>
        <span class="text-xs text-muted-foreground font-mono">{article.kbId}</span>
        <DotIcon class="size-4" />
        <span class="text-sm font-medium truncate">{article.title}</span>
        {#if article.tags.length > 0}
          <DotIcon class="size-4" />
          <div class="flex items-center gap-1.5 flex-wrap">
            {#each article.tags as tag (tag.id)}
              <span
                class="inline-flex items-center rounded-full px-2 py-0.5 text-xs border"
                style="background-color: {tag.color}18; color: {tag.color}; border-color: {tag.color}30"
              >
                {tag.name}
              </span>
            {/each}
          </div>
        {/if}
        {#if article.status === 'draft' || hasOpenDraft}
          <DotIcon class="size-4" />
          <span
            class="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-xs text-primary"
          >
            Draft
          </span>
        {/if}
        {#if article.status === 'archived'}
          <DotIcon class="size-4" />
          <span
            class="rounded-full border border-muted-foreground/30 bg-muted px-2 py-0.5 text-xs text-muted-foreground"
          >
            Archived
          </span>
        {/if}
      </div>
      <div class="flex items-center gap-1.5 shrink-0">
        <Button variant="outline" size="sm" class="gap-1.5" onclick={openMetaDialog}>
          <SlidersHorizontal class="size-3.5" />
          Meta
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="gap-1.5"
          href="/wiki/create/{article.id}?context={article.primaryContextId}"
        >
          <Pencil class="size-3.5" />
          {hasOpenDraft || article.status === 'draft' ? 'Open Draft' : 'Edit'}
        </Button>
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="outline" size="sm" class="gap-1.5 text-destructive">
                <Trash2 class="size-3.5" />
                Delete
              </Button>
            {/snippet}
          </AlertDialog.Trigger>
          <AlertDialog.Content>
            <AlertDialog.Header>
              <AlertDialog.Title>Delete {article.kbId}?</AlertDialog.Title>
              <AlertDialog.Description>
                This removes the article and all customer/site overrides.
              </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action
                class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
                onclick={() => removeArticleMut.mutate(article.id)}
              >
                Delete
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        </AlertDialog.Root>
        <AlertDialog.Root>
          <AlertDialog.Trigger>
            {#snippet child({ props })}
              <Button {...props} variant="outline" size="sm" class="gap-1.5">
                <Archive class="size-3.5" />
                Archive
              </Button>
            {/snippet}
          </AlertDialog.Trigger>
          <AlertDialog.Content>
            <AlertDialog.Header>
              <AlertDialog.Title>Archive {article.kbId}?</AlertDialog.Title>
              <AlertDialog.Description>
                This changes the article status to archived. The article content and history stay
                intact.
              </AlertDialog.Description>
            </AlertDialog.Header>
            <AlertDialog.Footer>
              <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
              <AlertDialog.Action onclick={() => archiveArticleMut.mutate(article.id)}>
                Archive
              </AlertDialog.Action>
            </AlertDialog.Footer>
          </AlertDialog.Content>
        </AlertDialog.Root>
      </div>
    </div>

    <Dialog.Root bind:open={metaDialogOpen}>
      <Dialog.Content>
        <Dialog.Header>
          <Dialog.Title>Article Meta</Dialog.Title>
          <Dialog.Description>
            Update article contexts and tags without creating a draft or article version.
          </Dialog.Description>
        </Dialog.Header>

        <div class="flex flex-col gap-4 py-2 px-4">
          <div class="flex flex-col gap-1.5">
            <label class="text-xs font-medium uppercase text-muted-foreground" for="meta-primary">
              Primary Context
            </label>
            <SingleSelect
              selected={metaPrimaryContextId}
              options={contextOptions}
              placeholder="Choose primary context"
              searchPlaceholder="Search contexts..."
              onchange={(value) => {
                metaPrimaryContextId = value;
                metaLinkedContextIds = metaLinkedContextIds.filter((id) => id !== value);
              }}
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <div class="text-xs font-medium uppercase text-muted-foreground">Linked Contexts</div>
            <MultiSelect
              bind:selected={metaLinkedContextIds}
              options={linkedContextOptions}
              placeholder="Linked contexts"
              maxDisplay={2}
              searchPlaceholder="Search contexts..."
            />
          </div>

          <div class="flex flex-col gap-1.5">
            <div class="text-xs font-medium uppercase text-muted-foreground">Tags</div>
            <MultiSelect
              bind:selected={metaTagIds}
              options={tagOptions}
              placeholder="Choose tags"
              maxDisplay={3}
              searchPlaceholder="Search tags..."
            />
          </div>
        </div>

        <Dialog.Footer>
          <Button variant="outline" onclick={() => (metaDialogOpen = false)}>Cancel</Button>
          <Button disabled={!metaPrimaryContextId || updateMetaMut.isPending} onclick={saveMeta}>
            Save Meta
          </Button>
        </Dialog.Footer>
      </Dialog.Content>
    </Dialog.Root>

    <div class="flex flex-1 overflow-hidden">
      <div class="flex flex-col flex-1 overflow-hidden">
        <div class="flex-1 overflow-y-auto">
          <div class="flex min-h-full">
            {#if article.status !== 'draft'}
              <ArticleOutline json={displayedContentJson} container={articleContentEl} />
            {/if}
            <div class="max-w-4xl mx-auto px-8 py-6 flex flex-col gap-3 flex-1">
              {#if selectedVersion}
                <div class="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    class="gap-1.5"
                    onclick={() => (selectedVersionId = null)}
                  >
                    <ArrowLeft class="size-3.5" />
                    Return
                  </Button>
                  <span
                    class="inline-flex items-center rounded-full border border-warning/30 bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                  >
                    Viewing v{selectedVersion.versionNumber} · {formatDate(
                      selectedVersion.createdAt
                    )}
                  </span>
                </div>
              {/if}

              {#if primaryContextPath.length > 0}
                <nav class="flex items-center gap-1 text-xs text-muted-foreground flex-wrap">
                  <span class="font-medium text-foreground/70">Primary Context</span>
                  <span class="text-muted-foreground/40">·</span>
                  {#each primaryContextPath as cat, i (cat.id)}
                    {#if i > 0}
                      <ChevronRight class="size-3 shrink-0" />
                    {/if}
                    <a
                      href="/wiki/category/{cat.id}"
                      class="hover:text-foreground transition-colors"
                    >
                      {cat.name}
                    </a>
                  {/each}
                </nav>
              {/if}

              <p class="text-xs text-muted-foreground">
                By <strong class="text-foreground">{article.createdBy?.name ?? 'Unknown'}</strong>
                &nbsp;·&nbsp; Updated {formatDate(article.updatedAt)}
              </p>

              {#if article.linkedContexts.length > 0}
                <div class="flex items-center gap-1.5 text-xs text-muted-foreground flex-wrap">
                  <Link class="size-3.5" />
                  <span class="font-medium text-foreground/70">Linked in</span>
                  {#each article.linkedContexts as ctx (ctx.id)}
                    <a
                      href="/wiki/category/{ctx.id}"
                      class="rounded-full border px-2 py-0.5 transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      {ctx.name}
                    </a>
                  {/each}
                </div>
              {/if}

              <Separator />

              {#if article.status === 'draft'}
                <div class="rounded-md border border-primary/30 bg-primary/5 p-4">
                  <p class="text-sm font-medium text-foreground">
                    This article has not been published.
                  </p>
                  <p class="mt-1 text-sm text-muted-foreground">
                    Open the draft to continue editing or publish the first version.
                  </p>
                </div>
              {:else}
                {#if hasOpenDraft}
                  <div
                    class="rounded-md border border-primary/30 bg-primary/5 p-3 text-sm text-muted-foreground"
                  >
                    An unpublished draft exists for this article.
                  </div>
                {/if}
                <KbRefPopover>
                  <div class="tiptap" bind:this={articleContentEl}>
                    {#if selectedVersionId && selectedVersionQuery.isLoading}
                      <Loader />
                    {:else if selectedVersionId && selectedVersionQuery.isError}
                      <p class="text-sm text-destructive">Unable to load this version.</p>
                    {:else}
                      {@html displayedBody}
                    {/if}
                  </div>
                </KbRefPopover>
              {/if}
            </div>
          </div>
        </div>

        {#if selectedOverride !== null || isNewOverride}
          <div
            class="border-t bg-background flex flex-col shrink-0 overflow-hidden"
            style={overridePanelExpanded
              ? 'height: min(72vh, calc(100% - 4rem));'
              : `height: ${overridePanelHeight}px;`}
          >
            <div class="flex h-8 shrink-0 items-center justify-between border-b bg-muted/30 px-3">
              <button
                class="flex flex-1 cursor-row-resize items-center justify-center text-muted-foreground hover:text-foreground"
                onpointerdown={startOverridePanelResize}
                title="Drag to resize override panel"
              >
                <GripHorizontal class="size-4" />
              </button>
              <Button
                variant="ghost"
                size="icon-sm"
                title={overridePanelExpanded ? 'Restore override panel' : 'Expand override panel'}
                onclick={() => (overridePanelExpanded = !overridePanelExpanded)}
              >
                {#if overridePanelExpanded}
                  <Minimize2 class="size-3.5" />
                {:else}
                  <Maximize2 class="size-3.5" />
                {/if}
              </Button>
            </div>
            {#if isEditingOverride}
              <OverrideEditor
                override={isNewOverride ? null : selectedOverride}
                articleId={article.id}
                onClose={closeOverridePanel}
                onSave={handleOverrideSave}
              />
            {:else if selectedOverride}
              <div class="flex items-center gap-2 px-4 py-2 border-b bg-card/80 shrink-0">
                <span
                  class="text-xs px-1.5 py-0.5 rounded border font-medium shrink-0"
                  style={`background-color: ${OVERRIDE_TYPE_COLORS[selectedOverride.type]}18; color: ${OVERRIDE_TYPE_COLORS[selectedOverride.type]}; border-color: ${OVERRIDE_TYPE_COLORS[selectedOverride.type]}40`}
                >
                  {selectedOverride.type}
                </span>
                <span class="text-xs text-muted-foreground shrink-0"
                  >{selectedOverride.siteName}</span
                >
                <span class="text-muted-foreground/30 shrink-0">·</span>
                <span class="text-sm font-medium truncate flex-1">{selectedOverride.title}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  class="gap-1.5 shrink-0"
                  onclick={editSelectedOverride}
                >
                  <Pencil class="size-3.5" />
                  Edit
                </Button>
                <AlertDialog.Root>
                  <AlertDialog.Trigger>
                    {#snippet child({ props })}
                      <Button
                        {...props}
                        variant="ghost"
                        size="icon-sm"
                        title="Delete override"
                        class="shrink-0 text-destructive hover:text-destructive"
                      >
                        <Trash2 class="size-4" />
                      </Button>
                    {/snippet}
                  </AlertDialog.Trigger>
                  <AlertDialog.Content>
                    <AlertDialog.Header>
                      <AlertDialog.Title>Delete override?</AlertDialog.Title>
                      <AlertDialog.Description>
                        This removes the selected customer/site override from the article.
                      </AlertDialog.Description>
                    </AlertDialog.Header>
                    <AlertDialog.Footer>
                      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
                      <AlertDialog.Action
                        class="bg-destructive text-destructive-foreground hover:bg-destructive/80"
                        onclick={() => removeOverrideMut.mutate(selectedOverride!.id)}
                      >
                        Delete
                      </AlertDialog.Action>
                    </AlertDialog.Footer>
                  </AlertDialog.Content>
                </AlertDialog.Root>
                <Button variant="ghost" size="icon-sm" onclick={closeOverridePanel} title="Close">
                  <X class="size-4" />
                </Button>
              </div>
              <div class="flex-1 overflow-y-auto px-6 py-4">
                <KbRefPopover>
                  <div class="tiptap">
                    {@html renderOverrideHtml(selectedOverride)}
                  </div>
                </KbRefPopover>
              </div>
            {/if}
          </div>
        {/if}
      </div>

      <div class="w-72 shrink-0 border-l flex-col overflow-hidden hidden lg:flex">
        <div class="border-b px-3 py-2 shrink-0 flex items-center gap-2">
          <Search class="size-3.5 text-muted-foreground shrink-0" />
          <input
            bind:value={panelSearch}
            placeholder="Search panel…"
            class="text-sm bg-transparent border-0 outline-none flex-1 text-foreground placeholder:text-muted-foreground/50"
          />
          {#if panelSearch}
            <button
              onclick={() => (panelSearch = '')}
              class="text-muted-foreground hover:text-foreground"
            >
              <X class="size-3.5" />
            </button>
          {/if}
        </div>

        <div class="flex-1 overflow-y-auto">
          <!-- Contexts -->
          <div class="border-b">
            <button
              onclick={() => toggleSection('contexts')}
              class="flex items-center justify-between w-full px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            >
              <div class="flex items-center gap-1.5">
                <FolderOpen class="size-3.5" />
                Contexts
              </div>
              <ChevronDown
                class="size-3.5 transition-transform {openSections.contexts ? '' : '-rotate-90'}"
              />
            </button>

            {#if openSections.contexts}
              <div class="pb-2">
                {#if primaryContextPath.length > 0}
                  <a
                    href="/wiki/category/{article.primaryContextId}"
                    class="flex flex-col gap-1 px-3 py-2 hover:bg-muted/50 transition-colors"
                  >
                    <span class="text-xs font-medium text-foreground">Primary Context</span>
                    <span class="text-xs text-muted-foreground">
                      {primaryContextPath.map((c) => c.name).join(' / ')}
                    </span>
                  </a>
                {/if}
                {#if article.linkedContexts.length > 0}
                  <div class="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">
                    Linked Appearances
                  </div>
                  {#each article.linkedContexts as ctx (ctx.id)}
                    <a
                      href="/wiki/category/{ctx.id}"
                      class="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors"
                    >
                      <Link class="size-3.5 text-muted-foreground" />
                      <span class="text-xs text-foreground truncate">{ctx.name}</span>
                    </a>
                  {/each}
                {:else}
                  <p class="px-3 py-2 text-xs text-muted-foreground/60">No linked appearances.</p>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Overrides -->
          <div class="border-b">
            <button
              onclick={() => toggleSection('overrides')}
              class="flex items-center justify-between w-full px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            >
              <div class="flex items-center gap-1.5">
                <FileText class="size-3.5" />
                Overrides
                {#if filteredOverrides.length > 0}
                  <span
                    class="ml-0.5 px-1.5 py-0 rounded-full bg-muted text-muted-foreground font-normal text-xs"
                  >
                    {filteredOverrides.length}
                  </span>
                {/if}
              </div>
              <ChevronDown
                class="size-3.5 transition-transform {openSections.overrides ? '' : '-rotate-90'}"
              />
            </button>

            {#if openSections.overrides}
              <div class="pb-2">
                {#each filteredOverrides as o (o.id)}
                  <button
                    onclick={() => selectOverride(o)}
                    class="flex flex-col gap-1 w-full px-3 py-2 text-left hover:bg-muted/50 transition-colors {selectedOverride?.id ===
                    o.id
                      ? 'bg-primary/5'
                      : ''}"
                  >
                    <div class="flex w-full justify-between items-center">
                      <p class="text-xs font-medium text-foreground truncate">{o.siteName}</p>
                      <span
                        class="text-xs px-1.5 py-0 rounded border shrink-0"
                        style={`background-color: ${OVERRIDE_TYPE_COLORS[o.type]}18; color: ${OVERRIDE_TYPE_COLORS[o.type]}; border-color: ${OVERRIDE_TYPE_COLORS[o.type]}40`}
                      >
                        {formatStringProper(o.type)}
                      </span>
                    </div>
                    <p class="text-xs text-muted-foreground truncate">{o.title}</p>
                  </button>
                {/each}

                {#if filteredOverrides.length === 0 && !panelSearch}
                  <p class="px-3 py-2 text-xs text-muted-foreground/60">No overrides yet.</p>
                {:else if filteredOverrides.length === 0}
                  <p class="px-3 py-2 text-xs text-muted-foreground/60">No matches.</p>
                {/if}

                <div class="px-3 pt-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    class="w-full gap-1.5 text-xs justify-start text-muted-foreground hover:text-foreground"
                    onclick={openNewOverride}
                  >
                    <Plus class="size-3.5" />
                    Add Override
                  </Button>
                </div>
              </div>
            {/if}
          </div>

          <!-- History -->
          <div class="border-b">
            <button
              onclick={() => toggleSection('history')}
              class="flex items-center justify-between w-full px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            >
              <div class="flex items-center gap-1.5">
                <Clock class="size-3.5" />
                History
                {#if filteredVersions.length > 0}
                  <span
                    class="ml-0.5 px-1.5 py-0 rounded-full bg-muted text-muted-foreground font-normal text-xs"
                  >
                    {filteredVersions.length}
                  </span>
                {/if}
              </div>
              <ChevronDown
                class="size-3.5 transition-transform {openSections.history ? '' : '-rotate-90'}"
              />
            </button>

            {#if openSections.history}
              <div class="pb-2">
                {#each filteredVersions as v (v.id)}
                  <button
                    class="flex w-full items-start gap-2 px-3 py-2 text-left transition-colors hover:bg-muted/50 {selectedVersionId ===
                    v.id
                      ? 'bg-warning/10'
                      : ''}"
                    onclick={() => (selectedVersionId = v.id)}
                  >
                    <span class="text-xs font-mono text-muted-foreground shrink-0 mt-0.5">
                      v{v.versionNumber}
                    </span>
                    <div class="flex-1 min-w-0">
                      <p class="text-xs text-foreground truncate">
                        {v.changeNote ?? 'Initial version'}
                      </p>
                      <p class="text-xs text-muted-foreground">
                        {v.createdBy?.name ?? 'Unknown'} · {formatDate(v.createdAt)}
                      </p>
                    </div>
                  </button>
                {/each}
                {#if filteredVersions.length === 0}
                  <p class="px-3 py-2 text-xs text-muted-foreground/60">
                    {panelSearch ? 'No matches.' : 'No version history.'}
                  </p>
                {/if}
              </div>
            {/if}
          </div>

          <!-- Permissions -->
          <div>
            <button
              onclick={() => toggleSection('permissions')}
              class="flex items-center justify-between w-full px-3 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
            >
              <div class="flex items-center gap-1.5">
                <Shield class="size-3.5" />
                Permissions
              </div>
              <ChevronDown
                class="size-3.5 transition-transform {openSections.permissions ? '' : '-rotate-90'}"
              />
            </button>

            {#if openSections.permissions}
              <div class="px-3 pb-4">
                <div class="flex items-center gap-2 py-2">
                  <Globe class="size-4 text-success shrink-0" />
                  <span class="text-sm text-foreground">Visible to all members</span>
                </div>
                <p class="text-xs text-muted-foreground/60">
                  Granular permission controls are coming soon.
                </p>
              </div>
            {/if}
          </div>
        </div>
      </div>
    </div>
  </FadeIn>
{:else if articleQuery.isLoading}
  <Loader />
{:else}
  <FadeIn class="flex flex-col items-center justify-center size-full gap-3 text-muted-foreground">
    <FileText class="size-10 opacity-30" />
    <p class="text-sm">Article not found.</p>
    <Button variant="outline" size="sm" href="/wiki">Back to Wiki</Button>
  </FadeIn>
{/if}
