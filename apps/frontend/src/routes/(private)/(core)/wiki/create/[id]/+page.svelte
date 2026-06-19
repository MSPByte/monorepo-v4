<script lang="ts">
  import './_editor.css';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { getContext } from 'svelte';
  import { createQuery, createMutation, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { getContextPath } from '../../_wiki-utils.js';
  import RichEditor from '../../_rich-editor.svelte';
  import ArticleOutline from '../../_article-outline.svelte';

  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

  import ArrowLeft from '@lucide/svelte/icons/arrow-left';
  import Lock from '@lucide/svelte/icons/lock';
  import Save from '@lucide/svelte/icons/save';
  import Send from '@lucide/svelte/icons/send';
  import SingleSelect from '$lib/components/single-select.svelte';
  import Loader from '$lib/components/transition/loader.svelte';
  import { generateHTML } from '../../_render-content.js';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const articleId = $derived(page.params.id ?? 'new');
  const isNew = $derived(articleId === 'new');

  const articleQuery = createQuery(() => ({
    queryKey: ['wiki.articles.get', articleId],
    queryFn: () => trpc.wiki.articles.get.query({ id: articleId }),
    enabled: !isNew,
  }));

  const contextsQuery = createQuery(() => ({
    queryKey: ['wiki.contexts.list'],
    queryFn: () => trpc.wiki.contexts.list.query(),
  }));

  const allContexts = $derived(contextsQuery.data ?? []);

  // Initialize form state from query data
  let initialized = $state(false);
  let title = $state('');
  let contextId = $state(page.url.searchParams.get('context') ?? '');
  let bodyHtml = $state('<p></p>');
  let bodyJson = $state<Record<string, unknown> | undefined>(undefined);
  let bodyText = $state('');
  let isDirty = $state(false);
  let isSaving = $state(false);
  let viewMode = $state<'draft' | 'published'>('draft');
  let draftContentEl = $state<HTMLElement | null>(null);
  let publishedContentEl = $state<HTMLElement | null>(null);
  let publishDialogOpen = $state(false);
  let publishReason = $state('');

  $effect(() => {
    if (!isNew && articleQuery.data && !initialized) {
      const a = articleQuery.data;
      const draft = a.draft;
      title = draft?.title ?? a.title;
      contextId = draft?.primaryContextId ?? a.primaryContextId;
      bodyJson = (draft?.contentJson ?? a.contentJson) as Record<string, unknown>;
      bodyText = draft?.contentText ?? a.contentText;
      initialized = true;
    }
    if (isNew && !initialized) {
      initialized = true;
    }
  });

  const lockedByOther = $derived.by(() => {
    if (isNew || !articleQuery.data?.lock) return false;
    return true;
  });

  const lockName = $derived(articleQuery.data?.lock?.lockedBy.name ?? null);

  const contextOptions = $derived(
    allContexts.map((c) => ({
      label: getContextPath(c.id, allContexts)
        .map((ctx) => ctx.name)
        .join(' / '),
      value: c.id,
    }))
  );
  const currentLinkedContextIds = $derived(articleQuery.data?.linkedContexts.map((c) => c.id) ?? []);
  const currentTagIds = $derived(articleQuery.data?.tags.map((tag) => tag.id) ?? []);

  const draftPayload = $derived({
    title: title.trim(),
    primaryContextId: contextId,
    linkedContextIds: isNew ? [] : currentLinkedContextIds.filter((id) => id !== contextId),
    tagIds: isNew ? [] : currentTagIds,
    contentJson: bodyJson ?? { type: 'doc', content: [] },
    contentText: bodyText,
  });
  const hasOpenDraft = $derived(Boolean(articleQuery.data?.draft));
  const publishedHtml = $derived.by(() => {
    if (!articleQuery.data) return '<p></p>';
    return generateHTML(articleQuery.data.contentJson as any);
  });
  const draftInitialHtml = $derived(
    generateHTML((bodyJson ?? { type: 'doc', content: [] }) as any)
  );
  const outlineJson = $derived(
    viewMode === 'published' && articleQuery.data
      ? articleQuery.data.contentJson
      : (bodyJson ?? { type: 'doc', content: [] })
  );
  const outlineContainer = $derived(
    viewMode === 'published' && articleQuery.data ? publishedContentEl : draftContentEl
  );
  const requiresPublishReason = $derived(!isNew && (articleQuery.data?.versions.length ?? 0) > 0);
  const trimmedPublishReason = $derived(publishReason.trim());

  const createArticleMut = createMutation(() => ({
    mutationFn: (input: {
      title: string;
      primaryContextId: string;
      linkedContextIds: string[];
      tagIds: string[];
      contentJson: unknown;
      contentText: string;
    }) => trpc.wiki.articles.create.mutate(input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
      goto(`/wiki/${data.id}`);
    },
  }));

  const saveDraftMut = createMutation(() => ({
    mutationFn: (input: {
      articleId?: string;
      title: string;
      primaryContextId: string;
      linkedContextIds: string[];
      tagIds: string[];
      contentJson: unknown;
      contentText: string;
    }) => trpc.wiki.drafts.save.mutate(input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles.get', data.id] });
      if (isNew) goto(`/wiki/create/${data.id}`);
    },
  }));

  const publishDraftMut = createMutation(() => ({
    mutationFn: (input: {
      articleId: string;
      title: string;
      primaryContextId: string;
      linkedContextIds: string[];
      tagIds: string[];
      contentJson: unknown;
      contentText: string;
      changeNote?: string;
    }) => trpc.wiki.drafts.publish.mutate(input),
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.contexts.list'] });
      void queryClient.invalidateQueries({ queryKey: ['wiki.articles.get', data.id] });
      goto(`/wiki/${data.id}`);
    },
  }));

  async function saveDraft() {
    if (!title.trim() || !contextId) return;
    isSaving = true;

    saveDraftMut.mutate({
      articleId: isNew ? undefined : articleId,
      ...draftPayload,
    });

    isSaving = false;
    isDirty = false;
  }

  async function publishArticle(changeNote?: string) {
    if (!title.trim() || !contextId) return;
    isSaving = true;

    if (isNew) {
      createArticleMut.mutate({
        ...draftPayload,
      });
    } else {
      publishDraftMut.mutate({
        articleId,
        ...draftPayload,
        ...(changeNote ? { changeNote } : {}),
      });
    }

    isSaving = false;
    isDirty = false;
  }

  function requestPublish() {
    if (requiresPublishReason) {
      publishReason = '';
      publishDialogOpen = true;
      return;
    }

    publishArticle();
  }

  function confirmPublish() {
    if (!trimmedPublishReason) return;
    publishDialogOpen = false;
    publishArticle(trimmedPublishReason);
  }
</script>

<div class="flex flex-col size-full overflow-hidden">
  <div
    class="flex items-center justify-between px-4 py-2 border-b bg-card/70 backdrop-blur shrink-0 gap-2"
  >
    <div class="flex items-center gap-2 min-w-0">
      <Button
        variant="ghost"
        size="icon-sm"
        href={page.url.searchParams.get('context')
          ? `/wiki/category/${page.url.searchParams.get('context')}`
          : '/wiki'}
        title="Back to wiki"
      >
        <ArrowLeft class="size-4" />
      </Button>
      <span class="text-sm text-muted-foreground truncate">
        {isNew ? 'New Article' : (articleQuery.data?.kbId ?? articleId)}
      </span>
      {#if isDirty}
        <Badge
          class="bg-warning/10 text-warning border-warning/30 text-xs px-1.5 py-0 hidden sm:inline-flex"
        >
          Unsaved
        </Badge>
      {/if}
      {#if hasOpenDraft}
        <Badge class="bg-primary/10 text-primary border-primary/30 text-xs px-1.5 py-0">
          Draft
        </Badge>
      {/if}
    </div>

    <div class="flex items-center gap-1.5 shrink-0">
      {#if !isNew}
        <div class="flex items-center rounded-md border p-0.5">
          <Button
            variant={viewMode === 'draft' ? 'secondary' : 'ghost'}
            size="sm"
            class="h-7"
            onclick={() => (viewMode = 'draft')}
          >
            Draft
          </Button>
          <Button
            variant={viewMode === 'published' ? 'secondary' : 'ghost'}
            size="sm"
            class="h-7"
            onclick={() => (viewMode = 'published')}
          >
            Published
          </Button>
        </div>
      {/if}
      <Button variant="ghost" size="sm" class="gap-1.5" disabled={isSaving} onclick={saveDraft}>
        <Save class="size-3.5" />
        {isSaving ? 'Saving…' : 'Save Draft'}
      </Button>
      {#if !isNew}
        <Button
          variant="default"
          size="sm"
          class="gap-1.5"
          disabled={!title.trim() || !contextId}
          onclick={requestPublish}
        >
          <Send class="size-3.5" />
          Publish
        </Button>
      {:else}
        <Button
          variant="default"
          size="sm"
          class="gap-1.5"
          disabled={!title.trim() || !contextId}
          onclick={() => publishArticle()}
        >
          <Send class="size-3.5" />
          Create
        </Button>
      {/if}
    </div>
  </div>

  <AlertDialog.Root bind:open={publishDialogOpen}>
    <AlertDialog.Content>
      <AlertDialog.Header>
        <AlertDialog.Title>Publish article changes?</AlertDialog.Title>
        <AlertDialog.Description>
          Add a short reason for this publish. This will be saved in the article history.
        </AlertDialog.Description>
      </AlertDialog.Header>

      <div class="py-2">
        <Textarea
          bind:value={publishReason}
          placeholder="What changed?"
          class="min-h-24 resize-none"
          aria-label="Publish reason"
          onkeydown={(event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
              confirmPublish();
            }
          }}
        />
        {#if publishReason.length > 0 && !trimmedPublishReason}
          <p class="mt-2 text-xs text-destructive">Reason cannot be blank.</p>
        {/if}
      </div>

      <AlertDialog.Footer>
        <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
        <Button
          variant="default"
          disabled={!trimmedPublishReason || isSaving}
          onclick={confirmPublish}
        >
          Publish
        </Button>
      </AlertDialog.Footer>
    </AlertDialog.Content>
  </AlertDialog.Root>

  {#if lockedByOther}
    <div
      class="flex items-center gap-2 px-4 py-2 bg-warning/10 border-b border-warning/20 text-warning text-sm shrink-0"
    >
      <Lock class="size-4 shrink-0" />
      <span class="flex-1 min-w-0">
        This article is currently being edited by
        <strong>{lockName}</strong>. Your changes may conflict.
      </span>
      <Button
        variant="outline"
        size="sm"
        class="shrink-0 border-warning/40 text-warning hover:bg-warning/10 hover:text-warning"
      >
        Take Over
      </Button>
    </div>
  {/if}

  <div class="flex flex-1 overflow-hidden">
    <ArticleOutline json={outlineJson} container={outlineContainer} />

    <div class="flex flex-col flex-1 overflow-y-auto">
      <div class="flex flex-col gap-4 px-8 pt-6 pb-4 w-full mx-auto">
        <Input
          bind:value={title}
          placeholder="Untitled Article"
          class="text-2xl font-bold h-auto p-2 border-0 border-b border-border/60 rounded-none bg-transparent shadow-none focus-visible:ring-0 focus-visible:border-primary/50 placeholder:text-muted-foreground/35 transition-colors"
          oninput={() => (isDirty = true)}
        />

        <div class="flex items-start gap-4 w-full">
          <div class="flex items-center gap-2 w-full max-w-xl">
            <span class="text-xs text-muted-foreground uppercase shrink-0"> Primary </span>
            <div class="w-full">
              <SingleSelect
                bind:selected={contextId}
                options={contextOptions}
                onchange={() => (isDirty = true)}
              />
            </div>
          </div>
        </div>
      </div>

      <Separator class="w-full" />

      <div class="flex flex-1 w-full mx-auto min-h-96">
        {#if articleQuery.isLoading}
          <Loader />
        {:else if viewMode === 'published' && articleQuery.data}
          <div class="w-full max-w-4xl mx-auto px-8 py-6">
            <div class="tiptap" bind:this={publishedContentEl}>
              {@html publishedHtml}
            </div>
          </div>
        {:else}
          <div class="size-full" bind:this={draftContentEl}>
            {#key `${articleId}:${initialized}`}
              <RichEditor
                initialHtml={draftInitialHtml}
                bind:html={bodyHtml}
                bind:json={bodyJson}
                bind:text={bodyText}
                onchange={() => (isDirty = true)}
              />
            {/key}
          </div>
        {/if}
      </div>
    </div>
  </div>
</div>
