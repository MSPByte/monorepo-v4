<script lang="ts">
  import { page } from '$app/state';
  import { authClient } from '$lib/auth-client';
  import { Button } from '$lib/components/ui/button';

  let loading = $state(false);
  let error = $state<string | null>(null);

  const accountError = $derived(page.url.searchParams.get('error') === 'account');

  async function signInWithMicrosoft() {
    loading = true;
    error = null;

    const result = await authClient.signIn.social({
      provider: 'microsoft',
      callbackURL: '/home',
      errorCallbackURL: '/auth/login'
    });

    if (result.error) {
      error = result.error.message ?? 'Unable to start Microsoft sign in.';
      loading = false;
    }
  }
</script>

<div class="flex min-h-screen items-center justify-center px-4">
  <div class="flex w-full max-w-sm flex-col gap-5 rounded-lg border bg-background p-6 shadow-sm">
    <div class="space-y-1">
      <h1 class="text-xl font-semibold">Sign in</h1>
      <p class="text-sm text-muted-foreground">Use your Microsoft 365 account to continue.</p>
    </div>

    {#if accountError}
      <p class="text-sm text-destructive">
        Your account could not be found. Please contact your administrator.
      </p>
    {/if}

    <Button class="w-full" onclick={signInWithMicrosoft} disabled={loading}>
      {loading ? 'Redirecting...' : 'Continue with Microsoft'}
    </Button>

    {#if error}
      <p class="text-sm text-destructive">{error}</p>
    {/if}
  </div>
</div>
