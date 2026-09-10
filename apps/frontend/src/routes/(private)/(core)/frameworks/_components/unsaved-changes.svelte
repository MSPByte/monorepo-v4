<script lang="ts">
  import { beforeNavigate, goto } from '$app/navigation';
  import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';

  let { dirty, busy = false }: { dirty: boolean; busy?: boolean } = $props();
  let destination = $state<URL | null>(null);
  let open = $state(false);
  let leaving = false;
  beforeNavigate((navigation) => {
    if (
      leaving ||
      (!dirty && !busy) ||
      (!navigation.willUnload && navigation.to?.url.pathname === navigation.from?.url.pathname)
    )
      return;
    navigation.cancel();
    if (navigation.willUnload || busy) return;
    destination = navigation.to?.url ?? null;
    open = true;
  });
  async function leave() {
    if (!destination) return;
    leaving = true;
    try {
      await goto(destination);
    } finally {
      leaving = false;
    }
  }
</script>

<AlertDialog.Root bind:open>
  <AlertDialog.Content>
    <AlertDialog.Header
      ><AlertDialog.Title>Leave without saving?</AlertDialog.Title><AlertDialog.Description
        >Your unsaved framework changes will be lost. Policies and mappings that you already saved
        will remain.</AlertDialog.Description
      ></AlertDialog.Header
    >
    <AlertDialog.Footer
      ><AlertDialog.Cancel>Keep editing</AlertDialog.Cancel><AlertDialog.Action onclick={leave}
        >Discard and leave</AlertDialog.Action
      ></AlertDialog.Footer
    >
  </AlertDialog.Content>
</AlertDialog.Root>
