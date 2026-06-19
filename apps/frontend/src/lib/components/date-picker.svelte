<script lang="ts">
  import Calendar from "$lib/components/ui/calendar/calendar.svelte";
  import * as Popover from "$lib/components/ui/popover/index.js";
  import { Button } from "$lib/components/ui/button/index.js";
  import { Label } from "$lib/components/ui/label/index.js";
  import ChevronDownIcon from "@lucide/svelte/icons/chevron-down";
  import {
    getLocalTimeZone,
    today,
    type CalendarDate,

    type DateValue

  } from "@internationalized/date";
  
  let { title, value = $bindable(), maxValue }: { 
    title: string;
    value?: CalendarDate;
    maxValue?: DateValue
  } = $props();
  
  let open = $state(false);
</script>
  
<div class="flex flex-col gap-3">
  <Label class="px-1">{title}</Label>
  <Popover.Root bind:open>
    <Popover.Trigger>
    {#snippet child({ props })}
      <Button
      {...props}
      variant="outline"
      class="w-48 justify-between font-normal"
      >
      {value
        ? value.toDate(getLocalTimeZone()).toLocaleDateString()
        : "Select date"}
      <ChevronDownIcon />
      </Button>
    {/snippet}
    </Popover.Trigger>
    <Popover.Content class="w-auto overflow-hidden p-0" align="start">
    <Calendar
      type="single"
      bind:value
      captionLayout="dropdown"
      onValueChange={() => {
      open = false;
      }}
      {maxValue}
    />
    </Popover.Content>
  </Popover.Root>
</div>