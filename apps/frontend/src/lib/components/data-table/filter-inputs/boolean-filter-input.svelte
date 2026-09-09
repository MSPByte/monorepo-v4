<script lang="ts">
  import SingleSelect from "$lib/components/single-select.svelte";
  import { Label } from "$lib/components/ui/label";

  interface Props {
    value: boolean;
    onvaluechange: (value: boolean) => void;
  }

  let { value, onvaluechange }: Props = $props();
</script>

<div class="space-y-2">
  <Label>Value</Label>
  <SingleSelect aria-label="Filter value" allowClear={false} options={[{value:'true',label:'Yes / True'},{value:'false',label:'No / False'}]} selected={String(value)} onchange={(v) => v && onvaluechange(v === 'true')} />
</div>
