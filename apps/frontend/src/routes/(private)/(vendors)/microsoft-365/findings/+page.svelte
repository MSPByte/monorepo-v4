<script lang="ts">
  import { scopeStore } from '$lib/stores/scope.store.svelte';
  import VendorFindingsTable from '../../_VendorFindingsTable.svelte';
</script>

<div class="flex flex-col size-full p-4">
  <VendorFindingsTable
    linkId={scopeStore.currentLink}
    providerId="microsoft-365"
    showLinkColumn={!scopeStore.currentLink}
  />
</div>
