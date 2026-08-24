<script lang="ts">
  import { getContext } from 'svelte';
  import { useQueryClient } from '@tanstack/svelte-query';
  import { toast } from 'svelte-sonner';
  import type { createTrpcClient } from '$lib/trpc';
  import { showErrorToast, toUserMessage, logError } from '$lib/utils/errors';
  import * as Dialog from '$lib/components/ui/dialog/index.js';
  import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
  import Button from '$lib/components/ui/button/button.svelte';
  import { Input } from '$lib/components/ui/input/index.js';
  import { Label } from '$lib/components/ui/label/index.js';
  import Checkbox from '$lib/components/ui/checkbox/checkbox.svelte';
  import CopyIcon from '@lucide/svelte/icons/copy';
  import LoaderCircleIcon from '@lucide/svelte/icons/loader-circle';

  type Identity = { id: string; name: string; email: string };
  type Mode = 'random' | 'custom' | 'none';

  interface Props {
    open: boolean;
    identities: Identity[];
    onOpenChange: (open: boolean) => void;
    onSuccess?: () => Promise<void> | void;
  }

  let { open, identities, onOpenChange, onSuccess }: Props = $props();

  const trpc = getContext<ReturnType<typeof createTrpcClient>>('trpc');
  const queryClient = useQueryClient();

  let mode = $state<Mode>('random');
  let password = $state('');
  let forceChange = $state(true);
  let busy = $state(false);
  let resultPassword = $state<string | null>(null);
  let resultSummary = $state<string | null>(null);

  const count = $derived(identities.length);
  const targetLabel = $derived(
    count === 1
      ? (identities[0]?.email ?? identities[0]?.name ?? 'user')
      : `${count} identities`
  );

  $effect(() => {
    if (open) {
      mode = 'random';
      password = '';
      forceChange = true;
      busy = false;
      resultPassword = null;
      resultSummary = null;
    }
  });

  const submitLabel = $derived.by(() => {
    if (mode === 'none') return count > 1 ? 'Require Change' : 'Require Change at Next Sign-in';
    return count > 1 ? `Reset ${count} Passwords` : 'Reset Password';
  });

  const canSubmit = $derived.by(() => {
    if (busy) return false;
    if (mode === 'custom' && password.length < 8) return false;
    if (mode === 'none' && !forceChange) return false;
    return true;
  });

  async function submit() {
    if (!canSubmit) return;
    busy = true;
    try {
      const result = await trpc.vendor.resetM365IdentityPassword.mutate({
        ids: identities.map((i) => i.id),
        mode,
        password: mode === 'custom' ? password : undefined,
        forceChangeNextSignIn: forceChange,
      });

      if (result.result === 'failure') {
        logError(result.results[0]?.error, 'resetPassword');
        toast.error(toUserMessage(result.results[0]?.error, 'Password reset failed.'));
        return;
      }

      const noun = (n: number) => (n === 1 ? 'identity' : 'identities');
      const kind = mode === 'none' ? 'Require change' : 'Password reset';

      if (result.result === 'partial') {
        toast.warning(
          `${kind}: ${result.updated} ${noun(result.updated)}, ${result.failed} failed`
        );
      }

      await queryClient.invalidateQueries({ queryKey: ['vendor.tableData'] });
      await queryClient.invalidateQueries({ queryKey: ['vendor.identityDetails'] });
      if (onSuccess) await onSuccess();

      if (result.password && mode === 'random' && result.updated > 0) {
        resultPassword = result.password;
        resultSummary =
          count > 1
            ? `Set on ${result.updated} of ${count} ${noun(count)}. Copy it now — it will not be shown again.`
            : 'Copy it now — it will not be shown again.';
      } else {
        if (result.result === 'success') {
          toast.success(
            count > 1
              ? `${kind} applied to ${result.updated} ${noun(result.updated)}`
              : mode === 'none'
                ? 'Change required at next sign-in'
                : 'Password reset'
          );
        }
        onOpenChange(false);
      }
    } catch (err) {
      showErrorToast(err, 'Password reset failed. Please try again.');
    } finally {
      busy = false;
    }
  }

  async function copyResult() {
    if (!resultPassword) return;
    try {
      await navigator.clipboard.writeText(resultPassword);
      toast.success('Copied');
    } catch {
      toast.error('Copy failed');
    }
  }
</script>

<Dialog.Root
  {open}
  onOpenChange={(next) => {
    if (busy) return;
    if (!next) resultPassword = null;
    onOpenChange(next);
  }}
>
  <Dialog.Content class="sm:max-w-md">
    <Dialog.Header>
      <Dialog.Title>Reset Password</Dialog.Title>
      <Dialog.Description>
        {#if resultPassword}
          Password reset for <span class="font-medium">{targetLabel}</span>.
        {:else}
          Reset the Microsoft 365 password for <span class="font-medium">{targetLabel}</span>.
        {/if}
      </Dialog.Description>
    </Dialog.Header>
    <Dialog.Body>

    {#if resultPassword}
      <div class="grid gap-3">
        {#if resultSummary}
          <div class="text-sm text-muted-foreground">{resultSummary}</div>
        {/if}
        <div class="flex items-center gap-2">
          <div
            class="flex-1 rounded-md border bg-muted/30 px-3 py-2 font-mono text-sm break-all"
          >
            {resultPassword}
          </div>
          <Button size="sm" variant="outline" onclick={copyResult}>
            <CopyIcon class="size-3.5" />
            Copy
          </Button>
        </div>
      </div>
    {:else}
      <div class="grid gap-4">
        <div class="grid gap-2">
          <Label>Password source</Label>
          <RadioGroup.Root
            value={mode}
            onValueChange={(v) => (mode = v as Mode)}
            class="gap-2"
          >
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <RadioGroup.Item value="random" class="mt-0.5" />
              <div class="flex flex-col gap-0.5">
                <span>Generate a strong random password</span>
                <span class="text-xs text-muted-foreground">
                  Shown once after the reset — the same password is applied to every selected
                  identity.
                </span>
              </div>
            </label>
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <RadioGroup.Item value="custom" class="mt-0.5" />
              <div class="flex flex-col gap-0.5">
                <span>Enter a password</span>
                <span class="text-xs text-muted-foreground">
                  Applied to every selected identity. Useful for shared training credentials.
                </span>
              </div>
            </label>
            <label class="flex items-start gap-2 text-sm cursor-pointer">
              <RadioGroup.Item value="none" class="mt-0.5" />
              <div class="flex flex-col gap-0.5">
                <span>Don't reset password</span>
                <span class="text-xs text-muted-foreground">
                  Keep the current password and only apply the flag below.
                </span>
              </div>
            </label>
          </RadioGroup.Root>
        </div>

        {#if mode === 'custom'}
          <div class="grid gap-2">
            <Label for="reset-pw">New password</Label>
            <Input
              id="reset-pw"
              type="text"
              autocomplete="new-password"
              placeholder="Min 8 chars, 3 of upper/lower/digit/symbol"
              bind:value={password}
            />
          </div>
        {/if}

        <label class="flex items-center gap-2 text-sm cursor-pointer">
          <Checkbox bind:checked={forceChange} />
          <span>Require change at next sign-in</span>
        </label>
        {#if mode === 'none' && !forceChange}
          <div class="text-xs text-destructive">
            Enable this — nothing else would happen otherwise.
          </div>
        {/if}
      </div>

    {/if}
    </Dialog.Body>
    <Dialog.Footer>
      {#if resultPassword}
        <Button
          onclick={() => {
            resultPassword = null;
            onOpenChange(false);
          }}
        >
          Done
        </Button>
      {:else}
        <Button type="button" variant="ghost" disabled={busy} onclick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <Button type="button" disabled={!canSubmit} onclick={submit}>
          {#if busy}
            <LoaderCircleIcon class="size-4 animate-spin" />
          {/if}
          {submitLabel}
        </Button>
      {/if}
    </Dialog.Footer>
  </Dialog.Content>
</Dialog.Root>
