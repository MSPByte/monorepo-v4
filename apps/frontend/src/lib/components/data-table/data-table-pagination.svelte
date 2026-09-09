<script lang="ts">
  import SingleSelect from "$lib/components/single-select.svelte";
  import { Button } from "$lib/components/ui/button";
  import ChevronLeftIcon from "@lucide/svelte/icons/chevron-left";
  import ChevronRightIcon from "@lucide/svelte/icons/chevron-right";
  import ChevronsLeftIcon from "@lucide/svelte/icons/chevrons-left";
  import ChevronsRightIcon from "@lucide/svelte/icons/chevrons-right";

  interface Props {
    page: number;
    pageSize: number;
    total: number;
    selectedCount?: number;
    onpagechange: (page: number) => void;
    onpagesizechange: (size: number) => void;
  }

  let {
    page,
    pageSize,
    total,
    selectedCount = 0,
    onpagechange,
    onpagesizechange,
  }: Props = $props();

  const pageCount = $derived(Math.ceil(total / pageSize) || 1);
  const startRow = $derived(page * pageSize + 1);
  const endRow = $derived(Math.min((page + 1) * pageSize, total));
  const canPreviousPage = $derived(page > 0);
  const canNextPage = $derived(page < pageCount - 1);

</script>

<div class="flex flex-wrap items-center justify-between gap-3 px-2">
  <div class="flex gap-2 text-sm">
    <div class="flex w-fit items-center justify-center text-sm font-medium">
      Page {page + 1} of {pageCount} (Total: {total})
    </div>
    {#if selectedCount > 0}
      <span class="text-muted-foreground">
        {selectedCount} of {total} row(s) selected
      </span>
    {/if}
  </div>

  <div class="flex flex-wrap items-center gap-3 lg:gap-8">
    <!-- Rows per page -->
    <div class="flex items-center space-x-2">
      <p class="text-sm font-medium">Rows per page</p>
      <div class="w-20"><SingleSelect aria-label="Rows per page" allowClear={false} options={[25,50,100].map(size => ({value:String(size),label:String(size)}))} selected={String(pageSize)} onchange={(v) => v && onpagesizechange(Number(v))} class="h-8" disableSort /></div>
    </div>

    <!-- Navigation -->
    <div class="flex items-center space-x-2">
      <Button
        variant="outline"
        class="hidden h-8 w-8 p-0 lg:flex"
        onclick={() => onpagechange(0)}
        disabled={!canPreviousPage}
      >
        <span class="sr-only">Go to first page</span>
        <ChevronsLeftIcon class="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        class="h-8 w-8 p-0"
        onclick={() => onpagechange(page - 1)}
        disabled={!canPreviousPage}
      >
        <span class="sr-only">Go to previous page</span>
        <ChevronLeftIcon class="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        class="h-8 w-8 p-0"
        onclick={() => onpagechange(page + 1)}
        disabled={!canNextPage}
      >
        <span class="sr-only">Go to next page</span>
        <ChevronRightIcon class="h-4 w-4" />
      </Button>
      <Button
        variant="outline"
        class="hidden h-8 w-8 p-0 lg:flex"
        onclick={() => onpagechange(pageCount - 1)}
        disabled={!canNextPage}
      >
        <span class="sr-only">Go to last page</span>
        <ChevronsRightIcon class="h-4 w-4" />
      </Button>
    </div>
  </div>
</div>
