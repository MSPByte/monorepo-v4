<script lang="ts">
  import Loader from '$lib/components/transition/loader.svelte';
  import Badge from '$lib/components/ui/badge/badge.svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import { CircleHelp, Database, KeyRound, Sparkles, Monitor } from '@lucide/svelte';
  import type { Integration } from '@mspbyte/shared';

  let {
    integration,
    active,
    loading = false,
    workspace = false,
  }: {
    integration: Integration;
    active: boolean;
    loading?: boolean;
    workspace?: boolean;
  } = $props();
</script>

<div class="flex items-start justify-between gap-4">
  {#if workspace}
    <div class="fw-product-heading"><span class="fw-product-icon"><Monitor size={23} strokeWidth={1.6} /></span><div><nav aria-label="Breadcrumb" class="fw-breadcrumb"><a href="/setup/integrations">Integrations</a><span>/</span><span>{integration.name}</span></nav><div class="flex items-center gap-3"><h1>{integration.name}</h1>{#if !loading}<span class="fw-connected"><span></span>{active ? 'Configured' : 'Not configured'}</span>{/if}</div></div></div>
  {:else}
  <div class="flex flex-col gap-0.5">
    <div class="flex items-center gap-2">
      <h1 class="text-lg font-semibold">{integration.name}</h1>
      {#if !loading}
        <Badge
          variant="outline"
          class="{active
            ? 'bg-primary/15 text-primary border-primary/30'
            : 'bg-muted text-muted-foreground'} text-xs"
        >
          {active ? 'Configured' : 'Not configured'}
        </Badge>
      {/if}
      <Badge variant="outline" class="text-xs bg-muted text-muted-foreground">
        {integration.category.charAt(0).toUpperCase() + integration.category.slice(1)}
      </Badge>
    </div>
    <p class="text-xs text-muted-foreground">
      Manage {integration.name} credentials and site mappings.
    </p>
  </div>
  {/if}
  <Dialog.Root>
    <Dialog.Trigger>
      {#snippet child({ props })}
        <Button {...props} variant="outline" size="sm" class="shrink-0">
          <CircleHelp class="size-4" /> About
        </Button>
      {/snippet}
    </Dialog.Trigger>
    <Dialog.Content class="sm:max-w-xl">
      <Dialog.Header>
        <Dialog.Title>About {integration.name}</Dialog.Title>
        <Dialog.Description>{integration.info.summary}</Dialog.Description>
      </Dialog.Header>
      <Dialog.Body class="gap-4">
        <div class="grid gap-4 py-1 sm:grid-cols-2">
          <section class="rounded-lg border bg-muted/25 p-3">
            <div class="mb-2 flex items-center gap-2 text-sm font-medium">
              <Database class="size-4 text-primary" /> MSPByte manages
            </div>
            <ul class="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              {#each integration.info.manages as item}<li>{item}</li>{/each}
            </ul>
          </section>
          {#if integration.info.requirements?.length}
            <section class="rounded-lg border border-primary/20 bg-primary/[0.035] p-3">
              <div class="mb-2 flex items-center gap-2 text-sm font-medium">
                <KeyRound class="size-4 text-primary" /> Before you connect
              </div>
              <ul class="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
                {#each integration.info.requirements as item}<li>{item}</li>{/each}
              </ul>
            </section>
          {/if}
        </div>
        {#if integration.info.notes?.length}
          <section class="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 mt-2">
            <div class="mb-2 flex items-center gap-2 text-sm font-medium">
              <Sparkles class="size-4 text-amber-600" /> How MSPByte interprets it
            </div>
            <ul class="space-y-1.5 text-xs leading-relaxed text-muted-foreground">
              {#each integration.info.notes as note}<li>{note}</li>{/each}
            </ul>
          </section>
        {/if}
      </Dialog.Body>
    </Dialog.Content>
  </Dialog.Root>
</div>
