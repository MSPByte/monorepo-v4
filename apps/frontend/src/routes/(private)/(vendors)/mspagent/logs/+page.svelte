<script lang="ts">
  import { getContext } from 'svelte';
  import { createQuery } from '@tanstack/svelte-query';
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import { cn } from '$lib/utils';
  import type { createTrpcClient } from '$lib/trpc';

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');

  const NOW = Date.now();

  // Load agents for this site
  const agentsQuery = createQuery(() => ({
    queryKey: ['agents.list', scopeStore.currentSite],
    queryFn: () => trpc.agents.list.query({ siteId: scopeStore.currentSite! }),
    enabled: !!scopeStore.currentSite,
  }));

  const agents = $derived(agentsQuery.data ?? []);

  // Selected agent for log drill-down
  let selectedAgentId = $state<string | null>(null);

  $effect(() => {
    // Reset selection when site changes
    if (scopeStore.currentSite) selectedAgentId = null;
  });

  const selectedAgent = $derived(agents.find((a) => a.id === selectedAgentId) ?? null);

  const logsQuery = createQuery(() => ({
    queryKey: ['agents.listLogs', selectedAgentId],
    queryFn: () => trpc.agents.listLogs.query({ agentId: selectedAgentId! }),
    enabled: !!selectedAgentId,
  }));

  const logs = $derived(logsQuery.data ?? []);

  let logSearch = $state('');

  const filteredLogs = $derived(
    logs.filter(
      (l) =>
        !logSearch ||
        l.message.toLowerCase().includes(logSearch.toLowerCase()) ||
        l.method.toLowerCase().includes(logSearch.toLowerCase()),
    ),
  );

  function relativeTime(ts: Date | string | null | undefined) {
    if (!ts) return '—';
    const diff = NOW - new Date(ts).getTime();
    const mins = Math.floor(diff / 60_000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }
</script>

{#if !scopeStore.currentSite}
  <div class="flex flex-col items-center justify-center size-full gap-2 text-muted-foreground">
    <div class="text-sm font-medium">Select a site to view logs</div>
    <div class="text-xs">Use the site selector in the navigation bar</div>
  </div>
{:else}
  <div class="flex size-full overflow-hidden">
    <!-- Agent sidebar -->
    <div class="w-52 shrink-0 border-r flex flex-col overflow-hidden">
      <div
        class="px-3 py-2 border-b text-xs font-semibold text-muted-foreground uppercase tracking-wide"
      >
        Agents
      </div>
      <div class="flex-1 overflow-y-auto">
        {#if agentsQuery.isLoading}
          <div class="flex items-center justify-center h-16 text-xs text-muted-foreground">
            Loading…
          </div>
        {:else if agents.length === 0}
          <div class="flex items-center justify-center h-16 text-xs text-muted-foreground">
            No agents
          </div>
        {:else}
          {#each agents as agent}
            <button
              onclick={() => (selectedAgentId = agent.id)}
              class={cn(
                'w-full text-left px-3 py-2 text-sm transition-colors border-b last:border-0',
                selectedAgentId === agent.id
                  ? 'bg-primary/10 text-primary font-medium'
                  : 'hover:bg-muted/40 text-foreground',
              )}
            >
              <div class="truncate">{agent.hostname}</div>
              <div class="text-xs text-muted-foreground capitalize mt-0.5">{agent.platform}</div>
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <!-- Log view -->
    <div class="flex-1 flex flex-col overflow-hidden">
      {#if !selectedAgent}
        <div class="flex items-center justify-center size-full text-sm text-muted-foreground">
          Select an agent to view its logs
        </div>
      {:else}
        <!-- Toolbar -->
        <div class="flex items-center gap-3 px-4 py-3 border-b shrink-0">
          <div class="font-medium text-sm">{selectedAgent.hostname}</div>
          <input
            type="text"
            placeholder="Search logs..."
            bind:value={logSearch}
            class="px-3 py-1.5 text-sm rounded border bg-background focus:outline-none focus:ring-1 focus:ring-primary w-56 ml-2"
          />
          {#if !logsQuery.isLoading}
            <span class="text-xs text-muted-foreground ml-auto">{filteredLogs.length} entries</span>
          {/if}
        </div>

        <!-- Table -->
        <div class="flex-1 overflow-y-auto">
          {#if logsQuery.isLoading}
            <div class="flex items-center justify-center h-32 text-sm text-muted-foreground">
              Loading…
            </div>
          {:else if filteredLogs.length === 0}
            <div class="flex items-center justify-center h-32 text-sm text-muted-foreground">
              No logs found.
            </div>
          {:else}
            <table class="w-full text-sm">
              <thead>
                <tr class="border-b bg-muted/40">
                  <th
                    class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32"
                  >
                    Method
                  </th>
                  <th
                    class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide"
                  >
                    Message
                  </th>
                  <th
                    class="text-left px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-20"
                  >
                    Status
                  </th>
                  <th
                    class="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-28"
                  >
                    Elapsed (ms)
                  </th>
                  <th
                    class="text-right px-4 py-2 text-xs font-semibold text-muted-foreground uppercase tracking-wide w-32"
                  >
                    Timestamp
                  </th>
                </tr>
              </thead>
              <tbody>
                {#each filteredLogs as log}
                  <tr class="border-b hover:bg-muted/30 transition-colors">
                    <td class="px-4 py-2.5 text-xs font-mono text-muted-foreground">
                      {log.method}
                    </td>
                    <td class="px-4 py-2.5 text-sm text-muted-foreground truncate max-w-xs">
                      {log.message}
                    </td>
                    <td class="px-4 py-2.5">
                      <span
                        class={cn(
                          'inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium',
                          log.status === 0
                            ? 'bg-success/15 text-success'
                            : 'bg-destructive/15 text-destructive',
                        )}
                      >
                        {log.status}
                      </span>
                    </td>
                    <td class="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {log.timeElapsedMs}ms
                    </td>
                    <td class="px-4 py-2.5 text-right text-xs text-muted-foreground">
                      {relativeTime(log.createdAt)}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          {/if}
        </div>
      {/if}
    </div>
  </div>
{/if}
