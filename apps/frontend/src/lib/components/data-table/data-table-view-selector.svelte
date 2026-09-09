<script lang="ts">
  import SingleSelect from "$lib/components/single-select.svelte";
  import { Button } from "$lib/components/ui/button";
  import type { TableView } from "./types";

  interface Props {
    views: TableView[];
    activeView?: TableView;
    onviewchange: (view?: TableView) => void;
  }

  let { views, activeView, onviewchange }: Props = $props();

  const selectedViewId = $derived(activeView?.id || "all");
  const selectedViewLabel = $derived(activeView?.label || "All");
</script>

{#if views.length === 0}
  <!-- No views to display -->
{:else if views.length <= 4}
  <!-- For small number of views, show as tabs -->
  <div class="flex items-center gap-2">
    <Button
      variant={!activeView ? "default" : "outline"}
      size="sm"
      onclick={() => onviewchange(undefined)}
    >
      All
    </Button>
    {#each views as view (view.id)}
      <Button
        variant={activeView?.id === view.id ? "default" : "outline"}
        size="sm"
        onclick={() => onviewchange(view)}
      >
        {#if view.icon}
          {@const Icon = view.icon}
          <Icon class="mr-2 h-4 w-4" />
        {/if}
        {view.label}
      </Button>
    {/each}
  </div>
{:else}
  <!-- For many views, use dropdown -->
  <div class="w-44"><SingleSelect aria-label="Table view" allowClear={false} options={[{value:'all',label:'All'},...views.map(view => ({value:view.id,label:view.label}))]} selected={selectedViewId} onchange={(value) => onviewchange(views.find(view => view.id === value))} /></div>
{/if}
