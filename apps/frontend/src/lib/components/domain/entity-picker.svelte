<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import { STALE } from '$lib/query';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';

  type EntityType =
    | 'integration_link'
    | 'm365_identity'
    | 'm365_group'
    | 'm365_license'
    | 'm365_role'
    | 'sophos_endpoint';

  type Props = {
    entityType: EntityType;
    packageId?: string;
    integrationLinkId?: string;
    integrationId?: string;
    siteId?: string;
    // Single mode: string | null. Multi mode: string[].
    value: string | string[] | null;
    onValueChange: (value: string | string[] | null) => void;
    multiple?: boolean;
    placeholder?: string;
    disabled?: boolean;
  };

  let {
    entityType,
    packageId,
    integrationLinkId,
    integrationId,
    siteId,
    value,
    onValueChange,
    multiple = false,
    placeholder = 'Choose…',
    disabled = false,
  }: Props = $props();

  const trpc = getContext<TRPCClient<AppRouter>>('trpc');

  const optionsQuery = createQuery(() => ({
    queryKey: [
      'packages.entityOptions',
      entityType,
      packageId ?? null,
      integrationLinkId ?? null,
      integrationId ?? null,
      siteId ?? null,
    ],
    queryFn: () =>
      siteId && (entityType === 'm365_identity' || entityType === 'm365_license')
        ? trpc.siteProfile.entityOptions.query({ siteId, entityType })
        : trpc.packages.entityOptions.query({
            entityType,
            packageId,
            integrationLinkId,
            integrationId,
            siteId,
          }),
    staleTime: STALE.LIST,
  }));

  const options = $derived(
    (optionsQuery.data ?? []).map((o) => ({
      value: o.id,
      label: o.label,
      subLabel: o.subLabel,
      disabled: 'disabled' in o && typeof o.disabled === 'boolean' ? o.disabled : undefined,
    })),
  );
</script>

{#if multiple}
  <MultiSelect
    {options}
    selected={Array.isArray(value) ? value : []}
    {placeholder}
    {disabled}
    loading={optionsQuery.isFetching}
    onchange={(v) => onValueChange(v)}
  />
{:else}
  <SingleSelect
    {options}
    selected={typeof value === 'string' ? value : ''}
    {placeholder}
    {disabled}
    loading={optionsQuery.isFetching}
    onchange={(v) => onValueChange(v)}
  />
{/if}
