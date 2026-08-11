<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { AppRouter } from '@mspbyte/trpc';
  import type { TRPCClient } from '@trpc/client';
  import SingleSelect from '$lib/components/single-select.svelte';
  import MultiSelect from '$lib/components/multi-select.svelte';

  type EntityType = 'integration_link' | 'm365_identity' | 'm365_group' | 'm365_license';

  type Props = {
    entityType: EntityType;
    packageId?: string;
    integrationLinkId?: string;
    integrationId?: string;
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
    ],
    queryFn: () =>
      trpc.packages.entityOptions.query({
        entityType,
        packageId,
        integrationLinkId,
        integrationId,
      }),
    staleTime: 30_000,
  }));

  const options = $derived(
    (optionsQuery.data ?? []).map((o) => ({
      value: o.id,
      label: o.label,
      subLabel: o.subLabel,
      disabled: o.disabled,
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
