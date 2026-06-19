<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import { textColumn, boolBadgeColumn, nullableTextColumn } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn } from '$lib/components/data-table/types';
  import ForwardingRuleSheet from './_forwarding-rule-sheet.svelte';
  import InboxRuleSheet from './_inbox-rule-sheet.svelte';
  import ExchangeConfig from './_exchange-config.svelte';
  import type {
    m365MailboxForwarding,
    m365InboxRules,
    m365ExchangeConfigs,
  } from '@mspbyte/drizzle';

  type ForwardingRow = typeof m365MailboxForwarding.$inferSelect & Record<string, unknown>;
  type InboxRuleRow = typeof m365InboxRules.$inferSelect & Record<string, unknown>;
  type ExchangeConfigRow = typeof m365ExchangeConfigs.$inferSelect & Record<string, unknown>;

  const forwardingColumns: DataTableColumn<ForwardingRow>[] = [
    textColumn<ForwardingRow>('userPrincipalName', 'Mailbox'),
    nullableTextColumn<ForwardingRow>('forwardingAddress', 'Forwarding Address'),
    nullableTextColumn<ForwardingRow>('forwardingSmtpAddress', 'SMTP Forwarding'),
    boolBadgeColumn<ForwardingRow>('deliverToMailboxAndForward', 'Keep Copy', {
      trueLabel: 'Yes',
      falseLabel: 'No',
      falseVariant: 'muted',
    }),
  ];

  const inboxRuleColumns: DataTableColumn<InboxRuleRow>[] = [
    textColumn<InboxRuleRow>('mailboxUpn', 'Mailbox'),
    textColumn<InboxRuleRow>('ruleName', 'Rule Name'),
    boolBadgeColumn<InboxRuleRow>('enabled', 'Enabled', {
      trueLabel: 'Enabled',
      falseLabel: 'Disabled',
      falseVariant: 'muted',
    }),
    boolBadgeColumn<InboxRuleRow>('isSuspicious', 'Suspicious', {
      trueLabel: 'Yes',
      falseLabel: 'No',
      falseVariant: 'muted',
    }),
    boolBadgeColumn<InboxRuleRow>('deleteMessage', 'Deletes', {
      trueLabel: 'Yes',
      falseLabel: 'No',
      falseVariant: 'muted',
    }),
    boolBadgeColumn<InboxRuleRow>('forwardTo', 'Forwards', {
      trueLabel: 'Yes',
      falseLabel: 'No',
      falseVariant: 'muted',
      evaluate: (v) => Array.isArray(v) && v.length > 0,
    }),
    nullableTextColumn<InboxRuleRow>('moveToFolder', 'Move To Folder'),
  ];

  const configColumns: DataTableColumn<ExchangeConfigRow>[] = [
    nullableTextColumn<ExchangeConfigRow>('autoForwardingMode', 'Auto Forwarding'),
    boolBadgeColumn<ExchangeConfigRow>('rejectDirectSend', 'Reject Direct Send', {
      trueLabel: 'Enabled',
      falseLabel: 'Disabled',
      falseVariant: 'destructive',
    }),
    boolBadgeColumn<ExchangeConfigRow>('allowBasicAuthSmtp', 'Basic Auth SMTP', {
      trueLabel: 'Allowed',
      falseLabel: 'Blocked',
      falseVariant: 'muted',
    }),
  ];

  type Tab = 'forwarding' | 'inboxRules' | 'config';
  let activeTab = $state<Tab>('forwarding');

  let selectedForwarding = $state<ForwardingRow | null>(null);
  let selectedInboxRule = $state<InboxRuleRow | null>(null);
</script>

<div class="flex flex-col size-full overflow-hidden">
    <!-- Tab switcher -->
    <div class="flex items-center gap-1 px-4 py-2 border-b shrink-0">
      <button
        onclick={() => (activeTab = 'forwarding')}
        class="px-3 py-1.5 text-xs font-medium rounded transition-colors {activeTab === 'forwarding'
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
      >
        Forwarding Rules
      </button>
      <button
        onclick={() => (activeTab = 'inboxRules')}
        class="px-3 py-1.5 text-xs font-medium rounded transition-colors {activeTab === 'inboxRules'
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
      >
        Suspicious Inbox Rules
      </button>
      <button
        onclick={() => (activeTab = 'config')}
        class="px-3 py-1.5 text-xs font-medium rounded transition-colors {activeTab === 'config'
          ? 'bg-primary text-primary-foreground'
          : 'text-muted-foreground hover:text-foreground hover:bg-muted'}"
      >
        Exchange Config
      </button>
    </div>

    <!-- Content -->
    <div class="flex-1 overflow-hidden">
      {#if activeTab === 'forwarding'}
        <VendorDataTable
          table="m365_mailbox_forwarding"
          linkId={scopeStore.currentLink || undefined}
          integrationId="microsoft-365"
          columns={forwardingColumns}
          onrowclick={(row) => (selectedForwarding = row as ForwardingRow)}
        />
      {:else if activeTab === 'inboxRules'}
        <VendorDataTable
          table="m365_inbox_rules"
          linkId={scopeStore.currentLink || undefined}
          integrationId="microsoft-365"
          columns={inboxRuleColumns}
          onrowclick={(row) => (selectedInboxRule = row as InboxRuleRow)}
        />
      {:else if !scopeStore.currentLink}
        <VendorDataTable
          table="m365_exchange_configs"
          integrationId="microsoft-365"
          columns={configColumns}
        />
      {:else}
        <ExchangeConfig linkId={scopeStore.currentLink} />
      {/if}
    </div>
  </div>

  <ForwardingRuleSheet
    rule={selectedForwarding}
    onclose={() => (selectedForwarding = null)}
  />
  <InboxRuleSheet
    rule={selectedInboxRule}
    onclose={() => (selectedInboxRule = null)}
  />
