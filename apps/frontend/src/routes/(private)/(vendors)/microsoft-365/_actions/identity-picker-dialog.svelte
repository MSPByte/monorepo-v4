<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import MembershipDialog from './membership-dialog.svelte';
  import { summarizePairResult } from './summarize.js';

  type Relation =
    | { kind: 'group'; groupIds: string[]; anchorLabel: string }
    | { kind: 'license'; licenseIds: string[]; anchorLabel: string }
    | { kind: 'role'; roleIds: string[]; anchorLabel: string };

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    linkId: string;
    relation: Relation;
    onSuccess?: () => Promise<void> | void;
  }

  let { open, onOpenChange, linkId, relation, onSuccess }: Props = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const identitiesQuery = createQuery(() => ({
    queryKey: ['vendor.m365IdentityOptions', linkId],
    queryFn: () => trpc.vendor.m365IdentityOptions.query({ linkId }),
    enabled: open && !!linkId
  }));

  // For single-anchor Remove mode, load current assignees to filter Remove options.
  const singleAnchorId = $derived.by(() => {
    if (relation.kind === 'group' && relation.groupIds.length === 1) return relation.groupIds[0];
    if (relation.kind === 'license' && relation.licenseIds.length === 1)
      return relation.licenseIds[0];
    if (relation.kind === 'role' && relation.roleIds.length === 1) return relation.roleIds[0];
    return null;
  });

  type Assignee = { id: string; name: string; email: string; enabled: boolean };
  const assigneesQuery = createQuery(() => ({
    queryKey: ['vendor.currentAssignees', relation.kind, linkId, singleAnchorId],
    queryFn: async (): Promise<Assignee[]> => {
      if (!singleAnchorId) return [];
      if (relation.kind === 'group')
        return trpc.vendor.groupMembers.query({ linkId, groupId: singleAnchorId });
      if (relation.kind === 'role')
        return trpc.vendor.roleAssignees.query({ linkId, roleId: singleAnchorId });
      const licenses = licensesQuery.data ?? [];
      const license = licenses.find((l) => l.id === singleAnchorId);
      if (!license) return [];
      return trpc.vendor.licenseUsers.query({ linkId, skuId: license.skuId });
    },
    enabled: open && !!linkId && !!singleAnchorId
  }));

  // Only license kind needs the licenses lookup for skuId resolution.
  const licensesQuery = createQuery(() => ({
    queryKey: ['vendor.m365LicenseOptions', linkId],
    queryFn: () => trpc.vendor.m365LicenseOptions.query({ linkId }),
    enabled: open && !!linkId && relation.kind === 'license'
  }));

  const addOptions = $derived.by(() => {
    const currentIds = new Set((assigneesQuery.data ?? []).map((a) => a.id));
    return (identitiesQuery.data ?? []).map((i) => {
      const label = i.enabled
        ? `${i.name}  ·  ${i.email}`
        : `${i.name}  ·  ${i.email}  (disabled)`;
      const alreadyAssigned = singleAnchorId ? currentIds.has(i.id) : false;
      return {
        value: i.id,
        label: alreadyAssigned ? `${label}  ·  already assigned` : label,
        disabled: alreadyAssigned
      };
    });
  });

  const removeOptions = $derived.by(() => {
    if (singleAnchorId) {
      return (assigneesQuery.data ?? []).map((a) => ({
        value: a.id,
        label: `${a.name}  ·  ${a.email}`
      }));
    }
    return (identitiesQuery.data ?? []).map((i) => ({
      value: i.id,
      label: `${i.name}  ·  ${i.email}`
    }));
  });

  const loadingOptions = $derived(
    identitiesQuery.isPending ||
      (!!singleAnchorId && assigneesQuery.isPending) ||
      (relation.kind === 'license' && licensesQuery.isPending)
  );

  let submitting = $state(false);

  async function submit(mode: 'add' | 'remove', identityIds: string[]) {
    submitting = true;
    try {
      let result;
      let kindLabel: string;
      if (relation.kind === 'group') {
        result =
          mode === 'add'
            ? await trpc.vendor.addM365IdentitiesToGroups.mutate({
                identityIds,
                groupIds: relation.groupIds
              })
            : await trpc.vendor.removeM365IdentitiesFromGroups.mutate({
                identityIds,
                groupIds: relation.groupIds
              });
        kindLabel = mode === 'add' ? 'Add members' : 'Remove members';
        await queryClient.invalidateQueries({ queryKey: ['vendor.groupMembers'] });
      } else if (relation.kind === 'license') {
        result =
          mode === 'add'
            ? await trpc.vendor.assignM365LicensesToIdentities.mutate({
                identityIds,
                licenseIds: relation.licenseIds
              })
            : await trpc.vendor.removeM365LicensesFromIdentities.mutate({
                identityIds,
                licenseIds: relation.licenseIds
              });
        kindLabel = mode === 'add' ? 'Assign license' : 'Remove license';
        await queryClient.invalidateQueries({ queryKey: ['vendor.licenseUsers'] });
        await queryClient.invalidateQueries({ queryKey: ['vendor.m365LicenseAvailability'] });
        await queryClient.invalidateQueries({ queryKey: ['vendor.m365LicenseOptions'] });
      } else {
        result =
          mode === 'add'
            ? await trpc.vendor.assignM365RolesToIdentities.mutate({
                identityIds,
                roleIds: relation.roleIds
              })
            : await trpc.vendor.removeM365RolesFromIdentities.mutate({
                identityIds,
                roleIds: relation.roleIds
              });
        kindLabel = mode === 'add' ? 'Assign role' : 'Remove role';
        await queryClient.invalidateQueries({ queryKey: ['vendor.roleAssignees'] });
        await queryClient.invalidateQueries({ queryKey: ['vendor.assignedRoles'] });
      }
      summarizePairResult(kindLabel, result);
      await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.identityDetails'] });
      if (onSuccess) await onSuccess();
      onOpenChange(false);
    } finally {
      submitting = false;
    }
  }

  const title = $derived.by(() => {
    if (relation.kind === 'group') return 'Manage group members';
    if (relation.kind === 'license') return 'Manage license assignments';
    return 'Manage role assignments';
  });
</script>

<MembershipDialog
  {open}
  {onOpenChange}
  {title}
  subjectLabel={relation.anchorLabel}
  itemNoun="user"
  itemNounPlural="users"
  {addOptions}
  {removeOptions}
  {loadingOptions}
  {submitting}
  onSubmit={submit}
/>
