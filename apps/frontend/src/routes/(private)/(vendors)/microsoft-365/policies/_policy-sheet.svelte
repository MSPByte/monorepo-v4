<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import type { createTrpcClient } from '$lib/trpc';
  import { cn } from '$lib/utils';
  import * as Sheet from '$lib/components/ui/sheet/index.js';
  import * as Tabs from '$lib/components/ui/tabs/index.js';
  import SearchBar from '$lib/components/search-bar.svelte';
  import type { PolicyRow } from './_types.js';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  interface Props {
    policy: PolicyRow | null;
    linkId: string;
    onclose: () => void;
  }

  let { policy, linkId, onclose }: Props = $props();

  const CONTROL_LABELS: Record<string, string> = {
    block: 'Block Sign-In',
    mfa: 'Require MFA',
    compliantDevice: 'Require Compliant Device',
    domainJoinedDevice: 'Require Hybrid Azure AD Join',
    approvedApplication: 'Require Approved Client App',
    compliantApplication: 'Require App Protection Policy',
    passwordChange: 'Require Password Change',
  };

  const CLIENT_APP_LABELS: Record<string, string> = {
    browser: 'Browser',
    mobileAppsAndDesktopClients: 'Mobile Apps & Desktop Clients',
    exchangeActiveSync: 'Exchange ActiveSync',
    other: 'Other Clients',
  };

  const RISK_LABELS: Record<string, string> = {
    none: 'None',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  };

  const PLATFORM_LABELS: Record<string, string> = {
    windows: 'Windows',
    macOS: 'macOS',
    linux: 'Linux',
    android: 'Android',
    iOS: 'iOS',
    windowsPhone: 'Windows Phone',
  };

  const USER_ACTION_LABELS: Record<string, string> = {
    'urn:user:registerdevice': 'Register Device',
    'urn:user:registersecurityinfo': 'Register Security Info',
  };

  const LOCATION_LABELS: Record<string, string> = {
    All: 'All Locations',
    AllTrusted: 'All Trusted Locations',
  };

  const USER_LABELS: Record<string, string> = {
    All: 'All Users',
    GuestsOrExternalUsers: 'Guests / External Users',
  };

  function labelValue(value: string, map: Record<string, string>): string {
    return map[value] ?? value;
  }

  function formatId(id: string): string {
    if (id.length <= 12) return id;
    return id.slice(0, 8) + '…';
  }

  function isSpecialValue(value: string, map: Record<string, string>): boolean {
    return value in map;
  }

  let activeTab = $state('overview');
  let userSearch = $state('');

  $effect(() => {
    if (policy) {
      activeTab = 'overview';
      userSearch = '';
    }
  });

  const detailsQuery = createQuery(() => ({
    queryKey: ['vendor.policyDetails', linkId, policy?.id],
    queryFn: () => trpc.vendor.policyDetails.query({ linkId, policyId: policy!.id }),
    enabled: !!policy && !!linkId,
  }));

  const filteredIdentities = $derived(
    (detailsQuery.data?.identities ?? []).filter(
      (u) =>
        !userSearch ||
        u.name.toLowerCase().includes(userSearch.toLowerCase()) ||
        u.email.toLowerCase().includes(userSearch.toLowerCase()),
    ),
  );

  const filteredGroups = $derived(
    (detailsQuery.data?.groups ?? []).filter(
      (g) => !userSearch || g.name.toLowerCase().includes(userSearch.toLowerCase()),
    ),
  );

  const filteredRoles = $derived(
    (detailsQuery.data?.roles ?? []).filter(
      (r) => !userSearch || r.name.toLowerCase().includes(userSearch.toLowerCase()),
    ),
  );

  const stateInfo = $derived.by(() => {
    if (!policy) return { label: '', class: '' };
    if (policy.policyState === 'enabled') return { label: 'Enabled', class: 'bg-success/15 text-success' };
    if (policy.policyState === 'enabledForReportingButNotEnforced') return { label: 'Report Only', class: 'bg-warning/20 text-warning' };
    return { label: 'Disabled', class: 'bg-muted text-muted-foreground' };
  });

  const controls = $derived(policy?.grantControls?.builtInControls ?? []);

  const sessionFrequency = $derived.by(() => {
    const sf = policy?.sessionControls?.signInFrequency;
    if (!sf?.isEnabled) return null;
    if (sf.frequencyInterval === 'everyTime') return 'Every Sign-In';
    if (sf.value != null && sf.type) return `${sf.value} ${sf.type}`;
    return null;
  });

  const persistentBrowser = $derived.by(() => {
    const pb = policy?.sessionControls?.persistentBrowser;
    if (!pb?.isEnabled) return null;
    return pb.mode === 'always' ? 'Always Persistent' : pb.mode === 'never' ? 'Never Persistent' : 'Configured';
  });

  const specialIncludeUsers = $derived(
    (policy?.conditions?.users?.includeUsers ?? []).filter((v) => isSpecialValue(v, USER_LABELS)),
  );
  const specialExcludeUsers = $derived(
    (policy?.conditions?.users?.excludeUsers ?? []).filter((v) => isSpecialValue(v, USER_LABELS)),
  );

  const appScope = $derived.by(() => {
    const apps = policy?.conditions?.applications;
    if (!apps) return null;
    return {
      includeApplications: apps.includeApplications ?? [],
      excludeApplications: apps.excludeApplications ?? [],
      includeUserActions: apps.includeUserActions ?? [],
    };
  });

  const clientAppTypes = $derived(policy?.conditions?.clientAppTypes ?? []);
  const userRiskLevels = $derived(policy?.conditions?.userRiskLevels ?? []);
  const signInRiskLevels = $derived(policy?.conditions?.signInRiskLevels ?? []);

  const platformScope = $derived.by(() => {
    const p = policy?.conditions?.platforms;
    if (!p) return null;
    return { includePlatforms: p.includePlatforms ?? [], excludePlatforms: p.excludePlatforms ?? [] };
  });

  const locationScope = $derived.by(() => {
    const l = policy?.conditions?.locations;
    if (!l) return null;
    return { includeLocations: l.includeLocations ?? [], excludeLocations: l.excludeLocations ?? [] };
  });

  const hasConditionsContent = $derived(
    userRiskLevels.length > 0 ||
      signInRiskLevels.length > 0 ||
      (platformScope?.includePlatforms.length ?? 0) > 0 ||
      (platformScope?.excludePlatforms.length ?? 0) > 0 ||
      (locationScope?.includeLocations.length ?? 0) > 0 ||
      (locationScope?.excludeLocations.length ?? 0) > 0,
  );
</script>

<Sheet.Root
  open={!!policy}
  onOpenChange={(open) => {
    if (!open) onclose();
  }}
>
  <Sheet.Content side="right" class="w-120! max-w-120! flex flex-col p-0">
    {#if policy}
      <Sheet.Header class="p-4 border-b shrink-0">
        <Sheet.Title class="leading-snug">{policy.name}</Sheet.Title>
        <Sheet.Description>
          <span class={cn('inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium', stateInfo.class)}>
            {stateInfo.label}
          </span>
        </Sheet.Description>
      </Sheet.Header>

      <Tabs.Root bind:value={activeTab} class="flex flex-col flex-1 overflow-hidden">
        <Tabs.List class="mx-4 mt-3 shrink-0">
          <Tabs.Trigger value="overview">Overview</Tabs.Trigger>
          <Tabs.Trigger value="users">Users</Tabs.Trigger>
          <Tabs.Trigger value="applications">Applications</Tabs.Trigger>
          <Tabs.Trigger value="conditions">Conditions</Tabs.Trigger>
        </Tabs.List>

        <!-- Overview Tab -->
        <Tabs.Content value="overview" class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {#if policy.description}
            <p class="text-xs text-muted-foreground leading-relaxed">{policy.description}</p>
          {/if}

          {#if controls.length > 0}
            <div class="flex flex-col gap-2">
              <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                Grant Controls
                {#if policy.grantControls?.operator}
                  <span class="ml-1 normal-case font-normal">({policy.grantControls.operator})</span>
                {/if}
              </div>
              <div class="flex flex-wrap gap-1.5">
                {#each controls as control}
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                    {CONTROL_LABELS[control] ?? control}
                  </span>
                {/each}
              </div>
            </div>
          {/if}

          {#if sessionFrequency || persistentBrowser}
            <div class="border-t pt-3 flex flex-col gap-2">
              <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Session Controls</div>
              <div class="flex flex-col gap-1.5 text-sm">
                {#if sessionFrequency}
                  <div class="flex items-center justify-between">
                    <span class="text-muted-foreground">Sign-In Frequency</span>
                    <span class="font-medium">{sessionFrequency}</span>
                  </div>
                {/if}
                {#if persistentBrowser}
                  <div class="flex items-center justify-between">
                    <span class="text-muted-foreground">Persistent Browser</span>
                    <span class="font-medium">{persistentBrowser}</span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}

          {#if !policy.description && controls.length === 0 && !sessionFrequency && !persistentBrowser}
            <p class="text-sm text-muted-foreground">No overview information available.</p>
          {/if}
        </Tabs.Content>

        <!-- Users Tab -->
        <Tabs.Content value="users" class="flex-1 overflow-hidden flex flex-col">
          <div class="px-4 pt-3 pb-2 shrink-0">
            <SearchBar bind:value={userSearch} placeholder="Search users, groups, roles…" delay={150} />
          </div>
          <div class="flex-1 overflow-y-auto px-4 pb-4 flex flex-col gap-4">

            {#if specialIncludeUsers.length > 0 || specialExcludeUsers.length > 0}
              <div class="flex flex-col gap-2">
                <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Special Assignments</div>
                {#if specialIncludeUsers.length > 0}
                  <div class="flex flex-col gap-1">
                    <span class="text-xs text-muted-foreground">Included</span>
                    <div class="flex flex-wrap gap-1">
                      {#each specialIncludeUsers as v}
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                          {USER_LABELS[v]}
                        </span>
                      {/each}
                    </div>
                  </div>
                {/if}
                {#if specialExcludeUsers.length > 0}
                  <div class="flex flex-col gap-1">
                    <span class="text-xs text-muted-foreground">Excluded</span>
                    <div class="flex flex-wrap gap-1">
                      {#each specialExcludeUsers as v}
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive">
                          {USER_LABELS[v]}
                        </span>
                      {/each}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}

            {#if detailsQuery.isPending}
              <div class="flex flex-col gap-2">
                {#each [1, 2, 3] as _}
                  <div class="h-10 rounded bg-muted animate-pulse"></div>
                {/each}
              </div>
            {:else}
              {@const includedUsers = filteredIdentities.filter((u) => u.included)}
              {@const excludedUsers = filteredIdentities.filter((u) => !u.included)}
              {@const includedGroups = filteredGroups.filter((g) => g.included)}
              {@const excludedGroups = filteredGroups.filter((g) => !g.included)}
              {@const includedRoles = filteredRoles.filter((r) => r.included)}
              {@const excludedRoles = filteredRoles.filter((r) => !r.included)}

              {#if includedUsers.length > 0}
                <div class="flex flex-col gap-1">
                  <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Included Users ({detailsQuery.data?.identities.filter((u) => u.included).length})
                  </div>
                  <div class="flex flex-col">
                    {#each includedUsers as user}
                      <div class="flex flex-col py-2 border-b last:border-0">
                        <span class="text-sm font-medium">{user.name}</span>
                        <span class="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if excludedUsers.length > 0}
                <div class="flex flex-col gap-1">
                  <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Excluded Users ({detailsQuery.data?.identities.filter((u) => !u.included).length})
                  </div>
                  <div class="flex flex-col">
                    {#each excludedUsers as user}
                      <div class="flex flex-col py-2 border-b last:border-0">
                        <span class="text-sm font-medium">{user.name}</span>
                        <span class="text-xs text-muted-foreground">{user.email}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if includedGroups.length > 0}
                <div class="flex flex-col gap-1">
                  <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Included Groups ({detailsQuery.data?.groups.filter((g) => g.included).length})
                  </div>
                  <div class="flex flex-col">
                    {#each includedGroups as group}
                      <div class="py-2 border-b last:border-0">
                        <span class="text-sm font-medium">{group.name}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if excludedGroups.length > 0}
                <div class="flex flex-col gap-1">
                  <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Excluded Groups ({detailsQuery.data?.groups.filter((g) => !g.included).length})
                  </div>
                  <div class="flex flex-col">
                    {#each excludedGroups as group}
                      <div class="py-2 border-b last:border-0">
                        <span class="text-sm font-medium">{group.name}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if includedRoles.length > 0}
                <div class="flex flex-col gap-1">
                  <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Included Roles ({detailsQuery.data?.roles.filter((r) => r.included).length})
                  </div>
                  <div class="flex flex-col">
                    {#each includedRoles as role}
                      <div class="py-2 border-b last:border-0">
                        <span class="text-sm font-medium">{role.name}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if excludedRoles.length > 0}
                <div class="flex flex-col gap-1">
                  <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Excluded Roles ({detailsQuery.data?.roles.filter((r) => !r.included).length})
                  </div>
                  <div class="flex flex-col">
                    {#each excludedRoles as role}
                      <div class="py-2 border-b last:border-0">
                        <span class="text-sm font-medium">{role.name}</span>
                      </div>
                    {/each}
                  </div>
                </div>
              {/if}

              {#if specialIncludeUsers.length === 0 && specialExcludeUsers.length === 0 && filteredIdentities.length === 0 && filteredGroups.length === 0 && filteredRoles.length === 0}
                <p class="text-sm text-muted-foreground">
                  {userSearch ? 'No results match your search.' : 'No specific user assignments.'}
                </p>
              {/if}
            {/if}

          </div>
        </Tabs.Content>

        <!-- Applications Tab -->
        <Tabs.Content value="applications" class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {#if appScope}
            {#if appScope.includeApplications.length > 0}
              <div class="flex flex-col gap-2">
                <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Included Applications</div>
                <div class="flex flex-wrap gap-1">
                  {#each appScope.includeApplications as app}
                    {#if app === 'All' || app === 'AllApps'}
                      <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">All Apps</span>
                    {:else}
                      <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground" title={app}>
                        {formatId(app)}
                      </span>
                    {/if}
                  {/each}
                </div>
              </div>
            {/if}

            {#if appScope.excludeApplications.length > 0}
              <div class="flex flex-col gap-2">
                <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                  Excluded Applications ({appScope.excludeApplications.length})
                </div>
                <div class="flex flex-wrap gap-1">
                  {#each appScope.excludeApplications.slice(0, 20) as app}
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground" title={app}>
                      {formatId(app)}
                    </span>
                  {/each}
                  {#if appScope.excludeApplications.length > 20}
                    <span class="text-xs text-muted-foreground self-center">+{appScope.excludeApplications.length - 20} more</span>
                  {/if}
                </div>
              </div>
            {/if}

            {#if appScope.includeUserActions.length > 0}
              <div class="flex flex-col gap-2">
                <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">User Actions</div>
                <div class="flex flex-wrap gap-1">
                  {#each appScope.includeUserActions as action}
                    <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-foreground">
                      {USER_ACTION_LABELS[action] ?? action}
                    </span>
                  {/each}
                </div>
              </div>
            {/if}
          {/if}

          {#if clientAppTypes.length > 0}
            <div class="flex flex-col gap-2">
              <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Client App Types</div>
              <div class="flex flex-wrap gap-1.5">
                {#each clientAppTypes as cat}
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-foreground">
                    {CLIENT_APP_LABELS[cat] ?? cat}
                  </span>
                {/each}
              </div>
            </div>
          {/if}

          {#if !appScope && clientAppTypes.length === 0}
            <p class="text-sm text-muted-foreground">No application scope configured.</p>
          {/if}
        </Tabs.Content>

        <!-- Conditions Tab -->
        <Tabs.Content value="conditions" class="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
          {#if userRiskLevels.length > 0}
            <div class="flex flex-col gap-2">
              <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">User Risk</div>
              <div class="flex flex-wrap gap-1.5">
                {#each userRiskLevels as level}
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warning/15 text-warning">
                    {labelValue(level, RISK_LABELS)}
                  </span>
                {/each}
              </div>
            </div>
          {/if}

          {#if signInRiskLevels.length > 0}
            <div class="flex flex-col gap-2">
              <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Sign-In Risk</div>
              <div class="flex flex-wrap gap-1.5">
                {#each signInRiskLevels as level}
                  <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-warning/15 text-warning">
                    {labelValue(level, RISK_LABELS)}
                  </span>
                {/each}
              </div>
            </div>
          {/if}

          {#if platformScope && (platformScope.includePlatforms.length > 0 || platformScope.excludePlatforms.length > 0)}
            <div class="flex flex-col gap-2">
              <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Platforms</div>
              {#if platformScope.includePlatforms.length > 0}
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-muted-foreground">Included</span>
                  <div class="flex flex-wrap gap-1">
                    {#each platformScope.includePlatforms as p}
                      <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                        {PLATFORM_LABELS[p] ?? p}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}
              {#if platformScope.excludePlatforms.length > 0}
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-muted-foreground">Excluded</span>
                  <div class="flex flex-wrap gap-1">
                    {#each platformScope.excludePlatforms as p}
                      <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground">
                        {PLATFORM_LABELS[p] ?? p}
                      </span>
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          {#if locationScope && (locationScope.includeLocations.length > 0 || locationScope.excludeLocations.length > 0)}
            <div class="flex flex-col gap-2">
              <div class="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Locations</div>
              {#if locationScope.includeLocations.length > 0}
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-muted-foreground">Included</span>
                  <div class="flex flex-wrap gap-1">
                    {#each locationScope.includeLocations as loc}
                      {#if isSpecialValue(loc, LOCATION_LABELS)}
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-primary/10 text-primary">
                          {LOCATION_LABELS[loc]}
                        </span>
                      {:else}
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground" title={loc}>
                          {formatId(loc)}
                        </span>
                      {/if}
                    {/each}
                  </div>
                </div>
              {/if}
              {#if locationScope.excludeLocations.length > 0}
                <div class="flex flex-col gap-1">
                  <span class="text-xs text-muted-foreground">Excluded</span>
                  <div class="flex flex-wrap gap-1">
                    {#each locationScope.excludeLocations as loc}
                      {#if isSpecialValue(loc, LOCATION_LABELS)}
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-destructive/10 text-destructive">
                          {LOCATION_LABELS[loc]}
                        </span>
                      {:else}
                        <span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono bg-muted text-muted-foreground" title={loc}>
                          {formatId(loc)}
                        </span>
                      {/if}
                    {/each}
                  </div>
                </div>
              {/if}
            </div>
          {/if}

          {#if !hasConditionsContent}
            <p class="text-sm text-muted-foreground">No risk, platform, or location conditions configured.</p>
          {/if}
        </Tabs.Content>
      </Tabs.Root>
    {/if}
  </Sheet.Content>
</Sheet.Root>
