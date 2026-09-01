<script lang="ts">
  import type { Snippet } from 'svelte';
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { Integration } from '@mspbyte/shared';
  import type { createTrpcClient } from '$lib/trpc';
  import IntegrationHeader from './integration-header.svelte';
  import SiteLinkingTable from './site-linking-table.svelte';
  import type { ExternalOption } from './site-linking-table.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Settings, TriangleAlert, LoaderCircle } from '@lucide/svelte';
  import { enhance } from '$app/forms';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { showErrorToast } from '$lib/utils/errors';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import Loader from '$lib/components/transition/loader.svelte';

  type DbIntegration = Awaited<
    ReturnType<ReturnType<typeof createTrpcClient>['integrations']['get']['query']>
  >;

  let {
    integration,
    externalLabel,
    externalOptions,
    loadingExternal,
    credentials,
  }: {
    integration: Integration;
    externalLabel: string;
    externalOptions: ExternalOption[];
    loadingExternal: boolean;
    credentials: Snippet<[{ existingConfig: Record<string, unknown> | null; dbIntegration: DbIntegration }]>;
  } = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const integrationQuery = createQuery(() => ({
    queryKey: ['integrations.get', integration.id],
    queryFn: () => trpc.integrations.get.query({ id: integration.id }),
  }));

  const dbIntegration = $derived(integrationQuery.data ?? null);
  const isConfigured = $derived(!!(dbIntegration && !dbIntegration.deletedAt));
  const existingConfig = $derived((dbIntegration?.config as Record<string, unknown>) ?? null);

  let configSheetOpen = $state(false);
  let testingConnection = $state(false);
  let savingConfig = $state(false);
  let showDeleteConfirm = $state(false);
</script>

<AlertDialog.Root bind:open={showDeleteConfirm}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete {integration.name} Integration?</AlertDialog.Title>
      <AlertDialog.Description>
        This will remove the {integration.name} integration and all associated site mappings. This
        action can be undone within 30 days.
      </AlertDialog.Description>
    </AlertDialog.Header>
    <AlertDialog.Footer>
      <AlertDialog.Cancel>Cancel</AlertDialog.Cancel>
      <form
        method="POST"
        action="?/deleteIntegration"
        use:enhance={() => {
          return async ({ result }) => {
            showDeleteConfirm = false;
            if (result.type === 'redirect') goto(result.location);
          };
        }}
      >
        <AlertDialog.Action
          type="submit"
          class="bg-destructive text-destructive-foreground hover:bg-destructive/90"
        >
          Delete Integration
        </AlertDialog.Action>
      </form>
    </AlertDialog.Footer>
  </AlertDialog.Content>
</AlertDialog.Root>

{#if authStore.isAllowed('Integrations.Write')}
  <Sheet.Root bind:open={configSheetOpen}>
    <Sheet.Portal>
      <Sheet.Overlay />
      <Sheet.Content side="right" class="w-105 flex flex-col gap-0 p-0">
        <Sheet.Header class="p-4 border-b">
          <Sheet.Title>Configure {integration.name}</Sheet.Title>
          <Sheet.Description>Enter your {integration.name} API credentials.</Sheet.Description>
        </Sheet.Header>

        <form
          method="POST"
          action="?/save"
          class="flex flex-col flex-1 overflow-hidden"
          use:enhance={({ action }) => {
            const isTest = action.search.includes('testConnection');
            if (isTest) {
              testingConnection = true;
              return async ({ result }) => {
                testingConnection = false;
                if (result.type === 'success') {
                  toast.success('Connection test successful!');
                } else {
                  const errorData = result.type === 'failure' ? result.data?.error : undefined;
                  showErrorToast(errorData, 'Connection test failed. Check the credentials.', {
                    logLabel: `${integration.id}:test`,
                  });
                }
              };
            }
            savingConfig = true;
            return async ({ result }) => {
              savingConfig = false;
              if (result.type === 'success') {
                configSheetOpen = false;
                toast.success('Settings saved!');
              } else {
                const errorData = result.type === 'failure' ? result.data?.error : undefined;
                showErrorToast(errorData, 'Failed to save settings.', {
                  logLabel: `${integration.id}:save`,
                });
              }
            };
          }}
        >
          <div class="flex flex-col p-4 flex-1 overflow-y-auto gap-4">
            {@render credentials({ existingConfig, dbIntegration })}

            <Button
              type="submit"
              formaction="?/testConnection"
              variant="outline"
              size="sm"
              disabled={testingConnection}
              class="gap-2"
            >
              {#if testingConnection}
                <LoaderCircle class="size-4 animate-spin" />
              {/if}
              {testingConnection ? 'Testing...' : 'Test Connection'}
            </Button>
          </div>

          <Sheet.Footer class="flex justify-between p-4 border-t gap-2">
            {#if isConfigured}
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onclick={() => {
                  configSheetOpen = false;
                  showDeleteConfirm = true;
                }}
              >
                Delete Integration
              </Button>
            {:else}
              <div></div>
            {/if}
            <Button size="sm" type="submit" disabled={savingConfig}>
              {savingConfig ? 'Saving...' : 'Save'}
            </Button>
          </Sheet.Footer>
        </form>
      </Sheet.Content>
    </Sheet.Portal>
  </Sheet.Root>
{/if}

<div class="flex flex-col size-full p-4 gap-4 overflow-hidden">
  <div class="flex items-start justify-between shrink-0">
    <IntegrationHeader
      {integration}
      active={isConfigured}
      loading={integrationQuery.isLoading}
    />
    {#if authStore.isAllowed('Integrations.Write')}
      <Button variant="outline" size="sm" onclick={() => (configSheetOpen = true)} class="gap-2">
        <Settings class="size-4" />
        Configure
      </Button>
    {/if}
  </div>

  {#if integrationQuery.isLoading}
    <Loader />
  {:else if isConfigured}
    <SiteLinkingTable
      integration={integration.id}
      {externalLabel}
      {externalOptions}
      {loadingExternal}
      canWrite={authStore.isAllowed('Integrations.Write')}
      {isConfigured}
    />
  {:else}
    <div class="flex flex-col size-full justify-center items-center">
      <div
        class="flex items-center gap-3 px-4 py-3 w-fit rounded bg-warning/10 text-warning border border-warning/30"
      >
        <TriangleAlert class="size-4" />
        <span class="text-sm">
          {integration.name} is not configured yet. Click <strong>Configure</strong> to set up your
          credentials.
        </span>
      </div>
    </div>
  {/if}
</div>
