<script lang="ts">
  import { getContext } from 'svelte';
  import { goto } from '$app/navigation';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { ArrowLeft, ArrowRight, FileText, ListChecks, MapPin } from '@lucide/svelte';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import Button from '$lib/components/ui/button/button.svelte';
  import Input from '$lib/components/ui/input/input.svelte';
  import Textarea from '$lib/components/ui/textarea/textarea.svelte';
  import { Switch } from '$lib/components/ui/switch/index.js';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import UnsavedChanges from '../_components/unsaved-changes.svelte';

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');
  const queryClient = useQueryClient();
  const canManage = $derived(authStore.isAllowed('Frameworks.Write'));
  let name = $state('');
  let description = $state('');
  let category = $state('Baseline');
  let enabled = $state(true);
  let saving = $state(false);
  let created = $state(false);
  const dirty = $derived(
    !created && (!!name || !!description || category !== 'Baseline' || !enabled)
  );

  async function saveFramework() {
    if (saving || created || !canManage || !name.trim()) return;
    saving = true;
    try {
      const framework = await trpc.frameworks.create.mutate({
        name: name.trim(),
        description: description.trim() || null,
        category: category.trim() || null,
        enabled,
      });
      created = true;
      await queryClient.invalidateQueries({ queryKey: ['frameworks.tableData'] });
      toast.success('Framework created. Add policies to get started.');
      saving = false;
      await goto(`/frameworks/${framework.id}`);
    } catch (error) {
      showErrorToast(error, 'Failed to create framework.');
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head><title>Create framework · MSPByte</title></svelte:head>
<UnsavedChanges {dirty} busy={saving} />
<div class="size-full overflow-auto">
  <div class="framework-page">
    <a
      href="/frameworks"
      class="mb-6 inline-flex items-center gap-2 text-xs text-muted-foreground hover:text-primary"
      ><ArrowLeft class="size-3.5" />Framework library</a
    >
    <header class="framework-heading">
      <div>
        <p class="framework-eyebrow">New framework</p>
        <h1>Start with your standard.</h1>
        <p class="framework-description">
          Give your framework a clear purpose. You’ll add policies and choose where it applies next.
        </p>
      </div>
    </header>
    {#if canManage}
      <div class="framework-columns">
        <form
          class="framework-panel framework-form"
          onsubmit={(event) => {
            event.preventDefault();
            void saveFramework();
          }}
        >
          <div>
            <h2>Framework details</h2>
            <p class="framework-description">Make it easy for your team to recognize and reuse.</p>
          </div>
          <fieldset disabled={saving || created} class="grid gap-5">
            <div class="framework-field">
              <label for="framework-name">Name</label>
              <Input
                id="framework-name"
                aria-describedby="framework-name-help"
                bind:value={name}
                required
                placeholder="e.g. Essential security baseline"
                autocomplete="off"
              />
              <small id="framework-name-help"
                >Use the standard or outcome this framework represents.</small
              >
            </div>
            <div class="framework-field">
              <label for="framework-category">Category</label>
              <Input
                id="framework-category"
                aria-describedby="framework-category-help"
                bind:value={category}
                placeholder="e.g. Security, Compliance, Baseline"
              />
              <small id="framework-category-help"
                >Optional. Add a category that makes sense to your team.</small
              >
            </div>
            <label class="framework-field"
              >Description <Textarea
                bind:value={description}
                rows={4}
                placeholder="What does this framework check, and who is it for?"
              /></label
            >
            <div class="framework-toggle">
              <div>
                <strong id="enabled-label">Enable framework</strong>
                <p>
                  Evaluation requires policies and an enabled mapping. You can finish setup after
                  creating the framework.
                </p>
              </div>
              <Switch bind:checked={enabled} aria-labelledby="enabled-label" />
            </div>
          </fieldset>
          <div class="framework-savebar">
            <span>Next: add policies</span>
            <div class="flex gap-2">
              <Button variant="outline" href="/frameworks" disabled={saving}>Cancel</Button><Button
                type="submit"
                disabled={saving || created || !name.trim()}
                >{saving ? 'Creating…' : 'Create framework'}<ArrowRight class="size-4" /></Button
              >
            </div>
          </div>
        </form>
        <aside class="framework-panel">
          <div class="framework-panel-header"><h2>From standard to coverage</h2></div>
          <ol class="framework-checklist">
            <li>
              <FileText />
              <div>
                <strong>Define the framework</strong>
                <p>Name the standard and explain what it covers.</p>
              </div>
            </li>
            <li>
              <ListChecks />
              <div>
                <strong>Add your policies</strong>
                <p>
                  Select the checks that belong in this framework. Existing policies can be reused.
                </p>
              </div>
            </li>
            <li>
              <MapPin />
              <div>
                <strong>Choose where it applies</strong>
                <p>Map it to sites, site groups, integrations, or every site.</p>
              </div>
            </li>
          </ol>
        </aside>
      </div>
    {:else}<div class="framework-state">
        <h2>View access only</h2>
        <p>You need permission to manage frameworks to create one.</p>
        <Button href="/frameworks" variant="outline">Back to frameworks</Button>
      </div>{/if}
  </div>
</div>
