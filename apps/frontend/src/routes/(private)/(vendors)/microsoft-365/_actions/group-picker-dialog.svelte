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

  // Full options list for Assign mode.
  const groupsQuery = createQuery(() => ({
    queryKey: ['vendor.m365GroupOptions', linkId],
    queryFn: () => trpc.vendor.m365GroupOptions.query({ linkId }),
    enabled: open && !!linkId
  }));

  // Current memberships (single-identity) for Remove mode.
  const singleIdentity = $derived(identityIds.length === 1 ? identityIds[0] : null);
  const detailsQuery = createQuery(() => ({
    queryKey: ['vendor.identityDetails', linkId, singleIdentity],
    queryFn: () =>
      trpc.vendor.identityDetails.query({ linkId, identityId: singleIdentity! }),
    enabled: open && !!linkId && !!singleIdentity
  }));

  const addOptions = $derived.by(() => {
    const currentIds = new Set((detailsQuery.data?.groups ?? []).map((g) => g.id));
    return (groupsQuery.data ?? []).map((g) => ({
      value: g.id,
      label: g.mailEnabled ? `${g.name}  ·  mail` : g.name,
      disabled: singleIdentity ? currentIds.has(g.id) : false
    }));
  });

  const removeOptions = $derived.by(() => {
    // Single identity: show only what they belong to. Bulk: show full list so the user
    // can broadcast a remove (mutation ignores 404s per pair).
    if (singleIdentity) {
      return (detailsQuery.data?.groups ?? []).map((g) => ({ value: g.id, label: g.name }));
    }
    return (groupsQuery.data ?? []).map((g) => ({ value: g.id, label: g.name }));
  });

  const loadingOptions = $derived(
    groupsQuery.isPending || (!!singleIdentity && detailsQuery.isPending)
  );

  let submitting = $state(false);

  async function submit(mode: 'add' | 'remove', groupIds: string[]) {
    submitting = true;
    try {
      const result =
        mode === 'add'
          ? await trpc.vendor.addM365IdentitiesToGroups.mutate({ identityIds, groupIds })
          : await trpc.vendor.removeM365IdentitiesFromGroups.mutate({ identityIds, groupIds });
      summarizePairResult(mode === 'add' ? 'Add to groups' : 'Remove from groups', result);
      await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.identityDetails'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.groupMembers'] });
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
  title="Manage groups"
  subjectLabel={identityLabel}
  itemNoun="group"
  itemNounPlural="groups"
  {addOptions}
  {removeOptions}
  {loadingOptions}
  {submitting}
  onSubmit={submit}
/>
