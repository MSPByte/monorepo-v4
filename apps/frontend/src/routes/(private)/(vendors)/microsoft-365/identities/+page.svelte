<!-- TODO: Findings Implementation -->
<script lang="ts">
  import { getContext, onMount } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import { goto } from '$app/navigation';
  import { toast } from 'svelte-sonner';
  import { authStore } from '$lib/stores/auth.store.svelte';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import type { createTrpcClient } from '$lib/trpc';
  import VendorDataTable from '$lib/components/data-table/VendorDataTable.svelte';
  import {
    textColumn,
    boolBadgeColumn,
    relativeDateColumn,
  } from '$lib/components/data-table/column-defs';
  import type { DataTableColumn, RowAction } from '$lib/components/data-table/types';
  import RolesCell from '$lib/components/data-table/cells/roles-cell.svelte';
  import IdentitySheet from './_identity-sheet.svelte';
  import ResetPasswordDialog from './_reset-password-dialog.svelte';
  import GroupPickerDialog from '../_actions/group-picker-dialog.svelte';
  import LicensePickerDialog from '../_actions/license-picker-dialog.svelte';
  import RolePickerDialog from '../_actions/role-picker-dialog.svelte';
  import type { m365Identities } from '@mspbyte/drizzle';
  import LogOutIcon from '@lucide/svelte/icons/log-out';
  import ShieldOffIcon from '@lucide/svelte/icons/shield-off';
  import ShieldCheckIcon from '@lucide/svelte/icons/shield-check';
  import KeyRoundIcon from '@lucide/svelte/icons/key-round';
  import UsersIcon from '@lucide/svelte/icons/users';
  import KeySquareIcon from '@lucide/svelte/icons/key-square';
  import ShieldIcon from '@lucide/svelte/icons/shield';
  import WorkflowIcon from '@lucide/svelte/icons/workflow';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();
  const currentLinkId = $derived(scopeStore.currentLink || undefined);

  type IdentityRow = typeof m365Identities.$inferSelect & Record<string, unknown>;

  let selectedIdentity = $state<IdentityRow | null>(null);
  let roleMap = $state<Record<string, string>>({});

  onMount(async () => {
    try {
      const params = new URLSearchParams({
        table: 'm365Roles',
        valueColumn: 'templateId',
        labelColumn: 'name',
        limit: '500',
      });
      const res = await fetch(`/api/table-reference?${params}`);
      if (!res.ok) return;
      const rows = (await res.json()) as { value: string; label: string }[];
      roleMap = Object.fromEntries(rows.map((r) => [r.value, r.label]));
    } catch {
      // Fall back to raw templateIds if the lookup fails.
    }
  });

  const columns: DataTableColumn<IdentityRow>[] = $derived([
    textColumn<IdentityRow>('name', 'Name'),
    textColumn<IdentityRow>('email', 'Email'),
    textColumn<IdentityRow>('primaryEmail', 'Primary Email', undefined, undefined, {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>('jobTitle', 'Job Title', undefined, undefined, {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>('department', 'Department', undefined, undefined, {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>('companyName', 'Company', undefined, undefined, {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>('employeeId', 'Employee ID', undefined, undefined, {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>('officeLocation', 'Office Location', undefined, undefined, {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>('usageLocation', 'Usage Location', undefined, undefined, {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>('businessPhone', 'Business Phone', undefined, undefined, {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>('mobilePhone', 'Mobile Phone', undefined, undefined, {
      defaultHidden: true,
    }),
    boolBadgeColumn<IdentityRow>('onPremisesSyncEnabled', 'On-Prem Sync', {
      trueLabel: 'Enabled',
      falseLabel: 'Cloud-only',
      falseVariant: 'muted',
    }, {
      defaultHidden: true,
    }),
    relativeDateColumn<IdentityRow>('directoryCreatedAt', 'Created', {
      defaultHidden: true,
    }),
    textColumn<IdentityRow>(
      'type',
      'Type',
      undefined,
      { pretty: true },
      {
        filter: {
          type: 'select',
          operators: ['eq'],
          options: [
            { label: 'Member', value: 'member' },
            { label: 'Guest', value: 'guest' },
            { label: 'Service', value: 'service' },
          ],
        },
      }
    ),
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
    {
      key: 'assignedRoleTemplateIds',
      title: 'Roles',
      cellComponent: RolesCell,
      cellProps: { roleMap },
    },
    relativeDateColumn<IdentityRow>('lastSignInAt', 'Last Sign-in'),
    relativeDateColumn<IdentityRow>('lastNonInteractiveSignInAt', 'Last System Sign-in', {
      hideable: true,
      defaultHidden: true,
    }),
  ]);

  const canWrite = $derived(authStore.isAllowed('Vendors.Write'));
  const canRunPackages = $derived(authStore.isAllowed('Packages.Run'));

  // Phase 1 A/B: same reset-password action exposed via the new Package path.
  // Discovers the seeded "Reset M365 Password" package by name and disables
  // itself if it's not present.
  const packagesQuery = createQuery(() => ({
    queryKey: ['packages.list'],
    queryFn: () => trpc.packages.list.query(),
    staleTime: 60_000,
  }));
  const resetPasswordPackage = $derived(
    (packagesQuery.data ?? []).find(
      (p) => p.name === 'Reset M365 Password' && p.status === 'active'
    )
  );

  // Reset password dialog wiring — the shared dialog handles the mutation.
  let resetDialogOpen = $state(false);
  let resetTargets = $state<Array<{ id: string; name: string; email: string }>>([]);
  let resetOnComplete = $state<(() => Promise<void>) | null>(null);

  // Membership dialogs (group/license/role) — one Manage dialog per kind, shared
  // across row-actions and the sheet. Manage actions require every selected
  // identity to share one tenant (Graph API options are tenant-scoped); Reset
  // Password / Enable / Disable / Revoke are per-identity and stay enabled
  // across tenants.
  let membershipOpen = $state<null | 'group' | 'license' | 'role'>(null);
  let membershipTargets = $state<IdentityRow[]>([]);
  let membershipLinkIdOverride = $state<string | null>(null);
  let membershipRefetch = $state<(() => Promise<void>) | null>(null);

  const membershipLabel = $derived(
    membershipTargets.length === 1
      ? membershipTargets[0]?.email || membershipTargets[0]?.name || 'user'
      : `${membershipTargets.length} identities`
  );
  const membershipLinkId = $derived(membershipLinkIdOverride ?? '');

  // Returns a single linkId if every row shares it (or the active scope's link),
  // else null — used both by openMembership and the row-action disabled check.
  function resolveSharedLinkId(rows: IdentityRow[]): string | null {
    if (rows.length === 0) return null;
    if (currentLinkId) return currentLinkId;
    const linkIds = new Set(rows.map((r) => String(r.linkId)));
    return linkIds.size === 1 ? [...linkIds][0]! : null;
  }

  const manageDisabled = (rows: IdentityRow[]) => resolveSharedLinkId(rows) === null;

  function openMembership(
    kind: 'group' | 'license' | 'role',
    rows: IdentityRow[],
    refetch: () => Promise<void>
  ) {
    const link = resolveSharedLinkId(rows);
    if (!link) return;
    membershipLinkIdOverride = link;
    membershipTargets = rows;
    membershipRefetch = refetch;
    membershipOpen = kind;
  }

  async function invalidateAfter() {
    await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
    await queryClient.invalidateQueries({ queryKey: ['vendor.identityDetails'] });
  }

  function idsOf(rows: IdentityRow[]): string[] {
    return rows.map((r) => String(r['id'])).filter(Boolean);
  }

  function summarize(kind: string, updated: number, failed: number, skipped: number) {
    const noun = (n: number) => (n === 1 ? 'identity' : 'identities');
    if (failed > 0 && updated > 0) {
      toast.warning(`${kind}: ${updated} ${noun(updated)} updated, ${failed} failed`);
    } else if (failed > 0) {
      toast.error(`${kind}: failed on ${failed} ${noun(failed)}`);
    } else if (updated > 0) {
      toast.success(`${kind}: ${updated} ${noun(updated)}`);
    } else if (skipped > 0) {
      toast.info(`${kind}: nothing to do (${skipped} already in target state)`);
    } else {
      toast.info(`${kind}: no changes`);
    }
  }

  const rowActions: RowAction<IdentityRow>[] = $derived(
    !canWrite
      ? []
      : [
          {
            label: 'Enable',
            icon: ShieldCheckIcon,
            variant: 'outline',
            group: 'Status',
            preserveSelection: true,
            disabled: (rows) => rows.length === 0 || rows.every((r) => r['enabled'] === true),
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = idsOf(rows);
              if (ids.length === 0) return;
              setProgress(`Enabling ${ids.length}...`);
              const result = await trpc.vendor.setM365IdentityEnabled.mutate({
                ids,
                enabled: true,
              });
              await invalidateAfter();
              await fetchData();
              summarize('Enable', result.updated, result.failed, result.skipped);
            },
          },
          {
            label: 'Disable',
            icon: ShieldOffIcon,
            variant: 'outline',
            group: 'Status',
            preserveSelection: true,
            disabled: (rows) => rows.length === 0 || rows.every((r) => r['enabled'] === false),
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = idsOf(rows);
              if (ids.length === 0) return;
              setProgress(`Disabling ${ids.length}...`);
              const result = await trpc.vendor.setM365IdentityEnabled.mutate({
                ids,
                enabled: false,
              });
              await invalidateAfter();
              await fetchData();
              summarize('Disable', result.updated, result.failed, result.skipped);
            },
          },
          {
            label: 'Revoke Sessions',
            icon: LogOutIcon,
            variant: 'outline',
            group: 'Status',
            preserveSelection: true,
            onclick: async (rows, fetchData, { setProgress }) => {
              const ids = idsOf(rows);
              if (ids.length === 0) return;
              setProgress(`Revoking sessions for ${ids.length}...`);
              const result = await trpc.vendor.revokeM365IdentitySessions.mutate({ ids });
              await invalidateAfter();
              await fetchData();
              summarize('Revoke Sessions', result.updated, result.failed, result.skipped);
            },
          },
          {
            label: 'Reset Password',
            icon: KeyRoundIcon,
            variant: 'outline',
            group: 'Password',
            preserveSelection: true,
            onclick: async (rows, fetchData) => {
              if (rows.length === 0) return;
              resetTargets = rows.map((r) => ({
                id: String(r['id']),
                name: String(r['name'] ?? ''),
                email: String(r['email'] ?? ''),
              }));
              resetOnComplete = async () => {
                await fetchData();
              };
              resetDialogOpen = true;
            },
          },
          {
            label: 'Reset via Package',
            icon: WorkflowIcon,
            variant: 'outline',
            group: 'Password',
            preserveSelection: true,
            disabled: (rows) => rows.length !== 1 || !resetPasswordPackage || !canRunPackages,
            onclick: async (rows) => {
              const pkg = resetPasswordPackage;
              if (!pkg || rows.length !== 1 || !canRunPackages) return;
              try {
                const result = await trpc.packageRuns.start.mutate({
                  packageId: pkg.id,
                  linkId: String(rows[0]!['linkId']),
                  siteId: (rows[0]!['siteId'] as string | null) ?? null,
                  runtimeInputs: { identityId: String(rows[0]!['id']) },
                });
                toast.success('Package run started', {
                  action: {
                    label: 'View',
                    onClick: () => goto(`/automation/runs/${result.packageRunId}`),
                  },
                });
              } catch (err) {
                toast.error(err instanceof Error ? err.message : 'Failed to start run');
              }
            },
          },
          {
            label: 'Manage Groups',
            icon: UsersIcon,
            variant: 'outline',
            group: 'Manage',
            preserveSelection: true,
            disabled: manageDisabled,
            onclick: (rows, fetchData) => openMembership('group', rows, fetchData),
          },
          {
            label: 'Manage Licenses',
            icon: KeySquareIcon,
            variant: 'outline',
            group: 'Manage',
            preserveSelection: true,
            disabled: manageDisabled,
            onclick: (rows, fetchData) => openMembership('license', rows, fetchData),
          },
          {
            label: 'Manage Roles',
            icon: ShieldIcon,
            variant: 'outline',
            group: 'Manage',
            preserveSelection: true,
            disabled: manageDisabled,
            onclick: (rows, fetchData) => openMembership('role', rows, fetchData),
          },
        ]
  );

  function openDrawer(identity: IdentityRow) {
    selectedIdentity = identity;
  }
</script>

<VendorDataTable
  table="m365_identities"
  linkId={currentLinkId}
  groupId={scopeStore.currentGroup || undefined}
  integrationId="microsoft-365"
  {columns}
  enableRowSelection={canWrite}
  {rowActions}
  actionMode="dropdown"
  onrowclick={(row) => openDrawer(row as IdentityRow)}
/>

<IdentitySheet
  identity={selectedIdentity}
  linkId={currentLinkId ?? String(selectedIdentity?.linkId ?? '')}
  onclose={() => (selectedIdentity = null)}
/>

<ResetPasswordDialog
  open={resetDialogOpen}
  identities={resetTargets}
  onOpenChange={(open) => (resetDialogOpen = open)}
  onSuccess={async () => {
    if (resetOnComplete) await resetOnComplete();
  }}
/>

<GroupPickerDialog
  open={membershipOpen === 'group'}
  onOpenChange={(open) => (membershipOpen = open ? 'group' : null)}
  linkId={membershipLinkId}
  identityIds={membershipTargets.map((r) => r.id)}
  identityLabel={membershipLabel}
  onSuccess={async () => {
    if (membershipRefetch) await membershipRefetch();
  }}
/>

<LicensePickerDialog
  open={membershipOpen === 'license'}
  onOpenChange={(open) => (membershipOpen = open ? 'license' : null)}
  linkId={membershipLinkId}
  identityIds={membershipTargets.map((r) => r.id)}
  identityLabel={membershipLabel}
  onSuccess={async () => {
    if (membershipRefetch) await membershipRefetch();
  }}
/>

<RolePickerDialog
  open={membershipOpen === 'role'}
  onOpenChange={(open) => (membershipOpen = open ? 'role' : null)}
  linkId={membershipLinkId}
  identityIds={membershipTargets.map((r) => r.id)}
  identityLabel={membershipLabel}
  onSuccess={async () => {
    if (membershipRefetch) await membershipRefetch();
  }}
/>
