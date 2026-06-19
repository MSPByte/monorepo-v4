<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { createTrpcClient } from '$lib/trpc';
  import IntegrationHeader from '../_helpers/integration-header.svelte';
  import SiteLinkingTable from '../_helpers/site-linking-table.svelte';
  import type { ExternalOption } from '../_helpers/site-linking-table.svelte';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as Card from '$lib/components/ui/card/index.js';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Settings, TriangleAlert, LoaderCircle } from '@lucide/svelte';
  import { enhance } from '$app/forms';
  import { toast } from 'svelte-sonner';
  import { goto } from '$app/navigation';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import type { PageProps } from './$types';
  import Loader from '$lib/components/transition/loader.svelte';

  const { data }: PageProps = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const integration = INTEGRATIONS['sophos-partner'];

  const integrationQuery = createQuery(() => ({
    queryKey: ['integrations.get', 'sophos-partner'],
    queryFn: () => trpc.integrations.get.query({ id: 'sophos-partner' }),
  }));

  const dbIntegration = $derived(integrationQuery.data ?? null);
  const isConfigured = $derived(!!(dbIntegration && !dbIntegration.deletedAt));
  const existingConfig = $derived((dbIntegration?.config as Record<string, unknown>) ?? null);

  let externalOptions = $state<ExternalOption[]>([]);
  let loadingExternal = $state(true);

  $effect(() => {
    data.tenants
      .then((tenants: { id: string; name: string; meta: { apiHost: string | null } }[]) => {
        externalOptions = tenants.map((t) => ({
          id: t.id,
          name: t.name,
          meta: { apiHost: t.meta.apiHost ?? null },
        }));
      })
      .catch(() => {
        /* silent — empty list shown */
      })
      .finally(() => {
        loadingExternal = false;
      });
  });

  let configSheetOpen = $state(false);
  let testingConnection = $state(false);
  let savingConfig = $state(false);
  let showDeleteConfirm = $state(false);
</script>

<AlertDialog.Root bind:open={showDeleteConfirm}>
  <AlertDialog.Content>
    <AlertDialog.Header>
      <AlertDialog.Title>Delete Sophos Partner Integration?</AlertDialog.Title>
      <AlertDialog.Description>
        This will remove the Sophos Partner integration and all associated site mappings. This
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
          <Sheet.Title>Configure Sophos Partner</Sheet.Title>
          <Sheet.Description>Enter your Sophos Partner API credentials.</Sheet.Description>
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
                if (result.type === 'success') toast.success('Connection test successful!');
                else toast.error((result as any).data?.error ?? 'Connection test failed');
              };
            }
            savingConfig = true;
            return async ({ result }) => {
              savingConfig = false;
              if (result.type === 'success') {
                configSheetOpen = false;
                toast.success('Settings saved!');
              } else {
                toast.error((result as any).data?.error ?? 'Save failed');
              }
            };
          }}
        >
          <div class="flex flex-col p-4 flex-1 overflow-y-auto gap-4">
            <Card.Root class="bg-primary/5 border-primary/20">
              <Card.Header class="pb-2">
                <Card.Title class="text-base">API Credentials</Card.Title>
              </Card.Header>
              <Card.Content class="flex flex-col gap-3">
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium" for="sophos-client-id">Client ID</label>
                  <input
                    id="sophos-client-id"
                    name="clientId"
                    type="text"
                    placeholder="Client ID"
                    class="w-full px-3 py-2 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    value={existingConfig?.clientId ?? ''}
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium" for="sophos-client-secret">Client Secret</label
                  >
                  <input
                    id="sophos-client-secret"
                    name="clientSecret"
                    type="password"
                    placeholder={existingConfig ? 'Leave blank to keep current' : 'Client Secret'}
                    class="w-full px-3 py-2 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>
                <div class="flex flex-col gap-1.5">
                  <label class="text-sm font-medium" for="sophos-expiry">
                    Credential Expiration
                    <span class="text-muted-foreground font-normal text-xs">(optional)</span>
                  </label>
                  <input
                    id="sophos-expiry"
                    name="credentialExpiration"
                    type="date"
                    class="w-full px-3 py-2 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
                    value={dbIntegration?.credentialExpiration
                      ? new Date(dbIntegration.credentialExpiration).toISOString().split('T')[0]
                      : ''}
                  />
                </div>
              </Card.Content>
            </Card.Root>

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
    <IntegrationHeader {integration} active={isConfigured} loading={integrationQuery.isLoading} />
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
      externalLabel="Sophos Tenant"
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
          Sophos Partner is not configured yet. Click <strong>Configure</strong> to set up your credentials.
        </span>
      </div>
    </div>
  {/if}
</div>
