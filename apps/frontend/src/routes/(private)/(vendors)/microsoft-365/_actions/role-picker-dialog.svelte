<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import MembershipDialog from './membership-dialog.svelte';
  import { summarizePairResult } from './summarize.js';

  interface Props {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    linkId: string;
    identityIds: string[];
    identityLabel: string;
    onSuccess?: () => Promise<void> | void;
  }

  let { open, onOpenChange, linkId, identityIds, identityLabel, onSuccess }: Props = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  const rolesQuery = createQuery(() => ({
    queryKey: ['vendor.m365RoleOptions'],
    queryFn: () => trpc.vendor.m365RoleOptions.query(),
    enabled: open
  }));

  const singleIdentity = $derived(identityIds.length === 1 ? identityIds[0] : null);
  const detailsQuery = createQuery(() => ({
    queryKey: ['vendor.identityDetails', linkId, singleIdentity],
    queryFn: () =>
      trpc.vendor.identityDetails.query({ linkId, identityId: singleIdentity! }),
    enabled: open && !!linkId && !!singleIdentity
  }));

  const addOptions = $derived.by(() => {
    const currentIds = new Set((detailsQuery.data?.roles ?? []).map((r) => r.id));
    return (rolesQuery.data ?? []).map((r) => ({
      value: r.id,
      label: r.name,
      disabled: singleIdentity ? currentIds.has(r.id) : false
    }));
  });

  const removeOptions = $derived.by(() => {
    if (singleIdentity) {
      return (detailsQuery.data?.roles ?? []).map((r) => ({ value: r.id, label: r.name }));
    }
    return (rolesQuery.data ?? []).map((r) => ({ value: r.id, label: r.name }));
  });

  const loadingOptions = $derived(
    rolesQuery.isPending || (!!singleIdentity && detailsQuery.isPending)
  );

  let submitting = $state(false);

  async function submit(mode: 'add' | 'remove', roleIds: string[]) {
    submitting = true;
    try {
      const result =
        mode === 'add'
          ? await trpc.vendor.assignM365RolesToIdentities.mutate({ identityIds, roleIds })
          : await trpc.vendor.removeM365RolesFromIdentities.mutate({ identityIds, roleIds });
      summarizePairResult(mode === 'add' ? 'Assign roles' : 'Remove roles', result);
      await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.identityDetails'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.roleAssignees'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.assignedRoles'] });
      if (onSuccess) await onSuccess();
      onOpenChange(false);
    } finally {
      submitting = false;
    }
  }
</script>

<MembershipDialog
  {open}
  {onOpenChange}
  title="Manage roles"
  subjectLabel={identityLabel}
  itemNoun="role"
  itemNounPlural="roles"
  {addOptions}
  {removeOptions}
  {loadingOptions}
  {submitting}
  onSubmit={submit}
/>
