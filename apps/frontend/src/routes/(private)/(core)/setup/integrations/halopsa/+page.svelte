<script lang="ts">
  import { INTEGRATIONS } from '@mspbyte/shared';
  import type { HaloPSASite } from '@mspbyte/shared';
  import type { PageProps } from './$types';
  import IntegrationConfigPage from '../_helpers/integration-config-page.svelte';
  import type { ExternalOption } from '../_helpers/site-linking-table.svelte';
  import * as Card from '$lib/components/ui/card/index.js';
  import Input from '$lib/components/ui/input/input.svelte';
  import SingleSelect from '$lib/components/single-select.svelte';

  const { data }: PageProps = $props();

  const integration = INTEGRATIONS['halopsa'];

  let externalOptions = $state<ExternalOption[]>([]);
  let loadingExternal = $state(true);

  // null = user hasn't changed selection yet; read from existingConfig in template
  let fallbackSiteId = $state<string | null>(null);

  $effect(() => {
    data.sites
      .then((sites: HaloPSASite[]) => {
        externalOptions = sites.map((s) => ({
          id: String(s.id),
          name: s.clientsite_name,
          meta: { clientId: s.client_id },
        }));
      })
      .catch(() => {})
      .finally(() => { loadingExternal = false; });
  });
</script>

<IntegrationConfigPage {integration} externalLabel="HaloPSA Site" {externalOptions} {loadingExternal}>
  {#snippet credentials({ existingConfig, dbIntegration })}
    <Card.Root class="bg-primary/5 border-primary/20">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">API Credentials</Card.Title>
      </Card.Header>
      <Card.Content class="flex flex-col gap-3">
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="halo-url">URL</label>
          <Input
            id="halo-url"
            name="url"
            type="url"
            placeholder="https://your-instance.halopsa.com"
            value={existingConfig?.url ?? ''}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="halo-client-id">Client ID</label>
          <Input
            id="halo-client-id"
            name="clientId"
            type="text"
            placeholder="Client ID"
            value={existingConfig?.clientId ?? ''}
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium" for="halo-client-secret">Client Secret</label>
          <Input
            id="halo-client-secret"
            name="clientSecret"
            type="password"
            placeholder={existingConfig ? 'Leave blank to keep current' : 'Client Secret'}
          />
        </div>
      </Card.Content>
    </Card.Root>

    <Card.Root class="bg-primary/5 border-primary/20">
      <Card.Header class="pb-2">
        <Card.Title class="text-base">Fallback Site</Card.Title>
        <Card.Description>
          Used when a site's linked HaloPSA site no longer exists (e.g. it was moved and its ID
          changed). Tickets that would otherwise fail submit against this site instead. Defaults to
          HaloPSA's built-in placeholder (-1).
        </Card.Description>
      </Card.Header>
      <Card.Content class="flex flex-col gap-3">
        <input
          type="hidden"
          name="fallbackSiteId"
          value={fallbackSiteId ?? (existingConfig?.fallbackSiteId as string | undefined) ?? '-1'}
        />
        <SingleSelect
          options={externalOptions.map((o) => ({ label: o.name, value: o.id }))}
          onchange={(v) => v && (fallbackSiteId = v)}
        />
      </Card.Content>
    </Card.Root>
  {/snippet}
</IntegrationConfigPage>
