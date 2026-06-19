<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, boolBadgeColumn, relativeDateColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import IdentitySheet from './_identity-sheet.svelte';
  import type { UiAlert } from '$lib/components/alerts/types';
  import type { m365Identities } from '@mspbyte/drizzle';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const currentLinkId = $derived(scopeStore.currentLink || undefined);

  type IdentityRow = typeof m365Identities.$inferSelect & Record<string, unknown>;

  let selectedIdentity = $state<IdentityRow | null>(null);

  const alertsQuery = createQuery(() => ({
    queryKey: ['alerts.list', currentLinkId, 'active', 'identity'],
    queryFn: () =>
      trpc.alerts.list.query({
        linkId: currentLinkId!,
        status: 'active',
        entityType: 'identity',
      }),
    enabled: !!currentLinkId && !!selectedIdentity,
  }));

  const alertsByEntityId = $derived.by(() => {
    const map = new Map<string, UiAlert[]>();
    for (const a of alertsQuery.data ?? []) {
      if (!a.entityId) continue;
      const list = map.get(a.entityId) ?? [];
      list.push(a);
      map.set(a.entityId, list);
    }
    return map;
  });

  const columns: DataTableColumn<IdentityRow>[] = [
    textColumn<IdentityRow>('name', 'Name'),
    textColumn<IdentityRow>('email', 'Email'),
    {
      key: 'type',
      title: 'Type',
      sortable: true,
      filter: {
        type: 'select',
        operators: ['eq'],
        options: [
          { label: 'Member', value: 'member' },
          { label: 'Guest', value: 'guest' },
          { label: 'Service', value: 'service' },
        ],
      },
    },
    boolBadgeColumn<IdentityRow>('enabled', 'Status', {
      trueLabel: 'Enabled',
      falseLabel: 'Disabled',
      falseVariant: 'destructive',
    }),
    boolBadgeColumn<IdentityRow>('mfaEnforced', 'MFA', {
      trueLabel: 'Enforced',
      falseLabel: 'Not Enforced',
      falseVariant: 'destructive',
    }),
    relativeDateColumn<IdentityRow>('lastSignInAt', 'Last Sign-in'),
  ];

  const identityAlerts = $derived.by((): UiAlert[] => {
    if (!selectedIdentity) return [];
    return alertsByEntityId.get(selectedIdentity.id) ?? [];
  });

  function openDrawer(identity: IdentityRow) {
    selectedIdentity = identity;
  }
</script>

<VendorDataTable
  table="m365_identities"
  linkId={currentLinkId}
  integrationId="microsoft-365"
  {columns}
  onrowclick={(row) => openDrawer(row as IdentityRow)}
/>

<IdentitySheet
  identity={selectedIdentity}
  linkId={currentLinkId ?? String(selectedIdentity?.linkId ?? '')}
  alerts={identityAlerts}
  onclose={() => (selectedIdentity = null)}
/>
