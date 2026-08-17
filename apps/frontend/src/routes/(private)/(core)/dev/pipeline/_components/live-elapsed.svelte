<script lang="ts">
  import { onDestroy } from 'svelte';

  // Ticks locally so the elapsed time reads as continuous even when the
  // server payload only refreshes every few seconds.
  let {
    startedAt,
    baseElapsedMs,
    class: className = '',
  }: {
    startedAt: string | null;
    baseElapsedMs?: number;
    class?: string;
  } = $props();

  let now = $state(Date.now());
  const interval = setInterval(() => (now = Date.now()), 1000);
  onDestroy(() => clearInterval(interval));

  const elapsedMs = $derived.by(() => {
    if (startedAt) return now - new Date(startedAt).getTime();
    return baseElapsedMs ?? 0;
  });

  function fmt(ms: number): string {
    if (ms < 0) ms = 0;
    const totalSec = Math.floor(ms / 1000);
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }
</script>

<span class={`tabular-nums ${className}`}>{fmt(elapsedMs)}</span>
