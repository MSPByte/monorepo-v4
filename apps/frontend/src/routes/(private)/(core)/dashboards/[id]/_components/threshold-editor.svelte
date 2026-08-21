<script lang="ts">
  import { Plus, Trash2 } from '@lucide/svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import SingleSelect from '$lib/components/single-select.svelte';

  type Tone = 'neutral' | 'primary' | 'warning' | 'danger' | 'success';
  type Threshold = { key: number; at: string; tone: Tone };
  let { thresholds = $bindable<Threshold[]>([]) }: { thresholds?: Threshold[] } = $props();
  let nextKey = $state(0);
  const tones = [
    { value: 'neutral', label: 'Neutral' },
    { value: 'primary', label: 'Primary' },
    { value: 'success', label: 'Success' },
    { value: 'warning', label: 'Warning' },
    { value: 'danger', label: 'Danger' },
  ];
  function add() {
    thresholds = [...thresholds, { key: Date.now() + nextKey++, at: '', tone: 'warning' }];
  }
  function update(key: number, patch: Partial<Threshold>) {
    thresholds = thresholds.map((threshold) =>
      threshold.key === key ? { ...threshold, ...patch } : threshold
    );
  }
  function remove(key: number) {
    thresholds = thresholds.filter((threshold) => threshold.key !== key);
  }
</script>

<section class="rounded-lg border bg-muted/20 p-4">
  <div class="mb-3 flex items-start justify-between gap-4">
    <div>
      <h3 class="text-sm font-semibold">Graph thresholds</h3>
      <p class="text-muted-foreground text-xs">Each value uses the highest threshold it reaches.</p>
    </div>
    <Button size="sm" variant="outline" class="gap-1" onclick={add}
      ><Plus class="size-3.5" />Add threshold</Button
    >
  </div>
  {#if thresholds.length === 0}
    <p class="text-muted-foreground text-sm">No thresholds. The graph uses its base color.</p>
  {:else}
    <div class="space-y-2">
      {#each thresholds as threshold (threshold.key)}
        <div class="grid grid-cols-[minmax(10rem,1fr)_minmax(12rem,1fr)_auto] items-end gap-3">
          <div class="space-y-2">
            <Label for={`threshold-${threshold.key}`}>At or above</Label><Input
              id={`threshold-${threshold.key}`}
              type="number"
              min="0"
              value={threshold.at}
              oninput={(event) => update(threshold.key, { at: event.currentTarget.value })}
            />
          </div>
          <div class="space-y-2">
            <Label>Treatment</Label><SingleSelect
              options={tones}
              selected={threshold.tone}
              onchange={(tone) => update(threshold.key, { tone: tone as Tone })}
            />
          </div>
          <Button
            variant="ghost"
            size="icon"
            onclick={() => remove(threshold.key)}
            aria-label="Remove threshold"><Trash2 class="size-4" /></Button
          >
        </div>
      {/each}
    </div>
  {/if}
</section>
