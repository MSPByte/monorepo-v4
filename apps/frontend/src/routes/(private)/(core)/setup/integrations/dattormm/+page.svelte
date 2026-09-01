<script lang="ts">
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { DattoSite } from '@mspbyte/shared';
  import type { PageProps } from './$types';
  import IntegrationConfigPage from '../_helpers/integration-config-page.svelte';
  import type { ExternalOption } from '../_helpers/site-linking-table.svelte';
  import * as Card from '$lib/components/ui/card/index.js';
  import Input from '$lib/components/ui/input/input.svelte';

  const { data }: PageProps = $props();

  const integration = INTEGRATIONS['dattormm'];

  let externalOptions = $state<ExternalOption[]>([]);
  let loadingExternal = $state(true);

  $effect(() => {
    data.sites
      .then((sites: DattoSite[]) => {
        externalOptions = sites.map((s) => ({ id: s.uid, name: s.name }));
      })
      .catch(() => {})
      .finally(() => { loadingExternal = false; });
  });
</script>

<IntegrationConfigPage {integration} externalLabel="DattoRMM Site" {externalOptions} {loadingExternal}>
  {#snippet credentials({ existingConfig, dbIntegration })}
    <Card.Root class="bg-primary/5 border-primary/20">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">API Credentials</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="datto-url">URL</label>
          <Input
            id="datto-url"
            name="url"
            type="url"
            placeholder="https://pinotage-api.centrastage.net"
            value={existingConfig?.url ?? ''}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="datto-api-key">API Key</label>
          <Input
            id="datto-api-key"
            name="apiKey"
            type="text"
            placeholder="API Key"
            value={existingConfig?.apiKey ?? ''}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="datto-api-secret">API Secret Key</label>
          <Input
            id="datto-api-secret"
            name="apiSecretKey"
            type="password"
            placeholder={existingConfig ? 'Leave blank to keep current' : 'API Secret Key'}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="datto-var-name">Site Variable Name</label>
          <Input
            id="datto-var-name"
            name="siteVariableName"
            type="text"
            placeholder="MSPSiteCode"
            value={existingConfig?.siteVariableName ?? ''}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="datto-expiry">
            Credential Expiration
            <span class="text-muted-foreground font-normal text-xs">(optional)</span>
          </label>
          <Input
            id="datto-expiry"
            name="credentialExpiration"
            type="date"
            value={dbIntegration?.credentialExpiration
              ? new Date(dbIntegration.credentialExpiration).toISOString().split('T')[0]
              : ''}
          />
        </div>
      </Card.Content>
    </Card.Root>
  {/snippet}
</IntegrationConfigPage>
