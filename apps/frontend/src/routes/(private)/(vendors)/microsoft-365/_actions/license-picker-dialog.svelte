<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery, useQueryClient } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { STALE } from '$lib/query';
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

  const licensesQuery = createQuery(() => ({
    queryKey: ['vendor.m365LicenseOptions', linkId],
    queryFn: () => trpc.vendor.m365LicenseOptions.query({ linkId }),
    enabled: open && !!linkId
  }));

  // Live SKU counts — supersedes cached values in Assign mode.
  const availabilityQuery = createQuery(() => ({
    queryKey: ['vendor.m365LicenseAvailability', linkId],
    queryFn: () => trpc.vendor.m365LicenseAvailability.query({ linkId }),
    enabled: open && !!linkId,
    staleTime: STALE.ENTITY
  }));

  const singleIdentity = $derived(identityIds.length === 1 ? identityIds[0] : null);
  const detailsQuery = createQuery(() => ({
    queryKey: ['vendor.identityDetails', linkId, singleIdentity],
    queryFn: () =>
      trpc.vendor.identityDetails.query({ linkId, identityId: singleIdentity! }),
    enabled: open && !!linkId && !!singleIdentity
  }));

  const addOptions = $derived.by(() => {
    const live = new Map((availabilityQuery.data ?? []).map((a) => [a.skuId, a]));
    const currentIds = new Set((detailsQuery.data?.licenses ?? []).map((l) => l.id));
    return (licensesQuery.data ?? []).map((l) => {
      const entry = live.get(l.skuId);
      const total = entry ? entry.enabled : l.totalUnits;
      const consumed = entry ? entry.consumed : l.consumedUnits;
      const available = Math.max(0, total - consumed);
      const name = l.friendlyName || l.skuPartNumber;
      const alreadyAssigned = singleIdentity && currentIds.has(l.id);
      const label = alreadyAssigned
        ? `${name}  ·  already assigned`
        : `${name}  ·  ${available} of ${total} free`;
      return {
        value: l.id,
        label,
        disabled: alreadyAssigned || available === 0
      };
    });
  });

  const removeOptions = $derived.by(() => {
    if (singleIdentity) {
      return (detailsQuery.data?.licenses ?? []).map((l) => ({
        value: l.id,
        label: l.friendlyName || l.skuPartNumber
      }));
    }
    return (licensesQuery.data ?? []).map((l) => ({
      value: l.id,
      label: l.friendlyName || l.skuPartNumber
    }));
  });

  const loadingOptions = $derived(
    licensesQuery.isPending || (!!singleIdentity && detailsQuery.isPending)
  );

  const hint = $derived(availabilityQuery.isFetching ? 'checking live availability…' : undefined);

  let submitting = $state(false);

  async function submit(mode: 'add' | 'remove', licenseIds: string[]) {
    submitting = true;
    try {
      const result =
        mode === 'add'
          ? await trpc.vendor.assignM365LicensesToIdentities.mutate({ identityIds, licenseIds })
          : await trpc.vendor.removeM365LicensesFromIdentities.mutate({ identityIds, licenseIds });
      summarizePairResult(mode === 'add' ? 'Assign licenses' : 'Remove licenses', result);
      await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.identityDetails'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.licenseUsers'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.m365LicenseAvailability'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.m365LicenseOptions'] });
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
  title="Manage licenses"
  subjectLabel={identityLabel}
  itemNoun="license"
  itemNounPlural="licenses"
  {addOptions}
  {removeOptions}
  {loadingOptions}
  {hint}
  {submitting}
  onSubmit={submit}
/>
