<script lang="ts">
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { PageProps } from './$types';
  import IntegrationConfigPage from '../_helpers/integration-config-page.svelte';
  import type { ExternalOption } from '../_helpers/site-linking-table.svelte';
  import * as Card from '$lib/components/ui/card/index.js';
  import Input from '$lib/components/ui/input/input.svelte';

  const { data }: PageProps = $props();

  const integration = INTEGRATIONS['sophos-partner'];

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
      .catch(() => {})
      .finally(() => { loadingExternal = false; });
  });
</script>

<IntegrationConfigPage {integration} externalLabel="Sophos Tenant" {externalOptions} {loadingExternal}>
  {#snippet credentials({ existingConfig, dbIntegration })}
    <Card.Root class="bg-primary/5 border-primary/20">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">API Credentials</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="sophos-client-id">Client ID</label>
          <Input
            id="sophos-client-id"
            name="clientId"
            type="text"
            placeholder="Client ID"
            value={existingConfig?.clientId ?? ''}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="sophos-client-secret">Client Secret</label>
          <Input
            id="sophos-client-secret"
            name="clientSecret"
            type="password"
            placeholder={existingConfig ? 'Leave blank to keep current' : 'Client Secret'}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="sophos-expiry">
            Credential Expiration
            <span class="text-muted-foreground font-normal text-xs">(optional)</span>
          </label>
          <Input
            id="sophos-expiry"
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
