import { useEffect, useRef, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { listen } from '@tauri-apps/api/event';
import { getSystemInfo, type SystemInfo } from '@/lib/agent';
import Loader from '@/ui/components/loader';
import { ipc, type EntraSsoStatus } from '@/lib/ipc';
import type { Bundle } from '@/lib/bundle';

export default function About() {
  const [info, setInfo] = useState<SystemInfo | undefined>(undefined);
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [sso, setSso] = useState<EntraSsoStatus | null>(null);
  const [authPending, setAuthPending] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const authPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    getSystemInfo().then((r) => setInfo(r.data)).catch(() => null);
    ipc.getEntraSsoStatus().then(setSso).catch(() => null);

    const refresh = () => ipc.getConfigBundle().then(setBundle).catch(() => null);
    refresh();
    const interval = window.setInterval(refresh, 10_000);

    const stopAuthPoll = () => {
      if (authPollRef.current !== null) {
        window.clearInterval(authPollRef.current);
        authPollRef.current = null;
      }
    };

    const unlistenComplete = listen('entra-auth-complete', () => {
      stopAuthPoll();
      setAuthPending(false);
      setAuthError(null);
      ipc.getEntraSsoStatus().then(setSso).catch(() => null);
    });

    const unlistenError = listen<string>('entra-auth-error', (event) => {
      stopAuthPoll();
      setAuthPending(false);
      setAuthError(event.payload ?? 'Authentication failed');
    });

    const unlistenRequired = listen('entra-auth-required', () => {
      setSso((prev) => prev ? { ...prev, user_prt_present: false } : prev);
    });

    return () => {
      window.clearInterval(interval);
      stopAuthPoll();
      unlistenComplete.then((f) => f());
      unlistenError.then((f) => f());
      unlistenRequired.then((f) => f());
    };
  }, []);

  const entraAuthEnabled = bundle?.entraAuthEnabled ?? false;

  async function handleSignIn() {
    setAuthPending(true);
    setAuthError(null);
    try {
      await ipc.startEntraAuth();
      // Poll SSO status every 2s while the browser flow is in progress.
      // This fires even if the Tauri event is missed due to the window being hidden.
      let elapsed = 0;
      authPollRef.current = window.setInterval(async () => {
        elapsed += 2000;
        const status = await ipc.getEntraSsoStatus().catch(() => null);
        if (status?.user_prt_present) {
          if (authPollRef.current !== null) window.clearInterval(authPollRef.current);
          authPollRef.current = null;
          setSso(status);
          setAuthPending(false);
        } else if (elapsed >= 300_000) {
          if (authPollRef.current !== null) window.clearInterval(authPollRef.current);
          authPollRef.current = null;
          setAuthPending(false);
          setAuthError('Authentication timed out');
        }
      }, 2000);
    } catch (e) {
      setAuthPending(false);
      setAuthError(String(e));
    }
  }

  async function handleSignOut() {
    await ipc.clearEntraAuth().catch(() => null);
    ipc.getEntraSsoStatus().then(setSso).catch(() => null);
  }

  const accentColor = bundle?.branding?.primaryColor;
  const headerBg = { backgroundColor: accentColor ?? 'hsl(var(--primary))' };
  const companyName = bundle?.branding?.appName ?? 'IT Support';
  const supportEmail = bundle?.branding?.supportEmail;
  const supportPhone = bundle?.branding?.supportPhone;

  return (
    <main className="flex flex-col size-full overflow-hidden">
      {/* Brand header */}
      <div className="flex items-center px-4 py-2 shrink-0" style={headerBg}>
        {bundle?.branding?.logoUrl && (
          <img src={bundle.branding.logoUrl} alt="" className="size-6 rounded object-contain bg-white/10 mr-2" />
        )}
        <span className="text-white font-semibold text-sm tracking-wide">{companyName} — About</span>
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto min-h-0 p-4 gap-4">
        {!info ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader />
          </div>
        ) : (
          <>
            <section className="flex flex-col gap-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-0.5">Device</p>
              <div className="border rounded-lg overflow-hidden divide-y text-sm">
                <Row label="PC Name" value={info.hostname} />
                <Row label="Username" value={info.username || 'N/A'} />
                <Row label="IP (LAN)" value={info.ip_address || 'N/A'} />
                <Row label="IP (WAN)" value={info.ext_address || 'N/A'} />
                <Row label="Version" value={info.version || 'N/A'} />
              </div>
            </section>

            <section className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-0.5">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Entra SSO</p>
                {sso && sso.source !== 'dsregcmd' && sso.source !== 'unavailable' && (
                  <p className="text-[10px] text-muted-foreground">
                    {sso.source === 'az_cli' ? 'via Azure CLI' : sso.source === 'cached' ? 'via saved login' : ''}
                  </p>
                )}
              </div>
              <div className="border rounded-lg overflow-hidden divide-y text-sm">
                {!sso ? (
                  <div className="px-3 py-2 text-muted-foreground text-sm">Checking…</div>
                ) : (
                  <>
                    {sso.source === 'dsregcmd' && (
                      <Row
                        label="Device joined"
                        value={sso.device_aad_joined ? '✓ Azure AD joined' : 'Not joined'}
                        highlight={sso.device_aad_joined}
                      />
                    )}
                    <Row
                      label="Status"
                      value={sso.user_prt_present ? '✓ Authenticated' : 'Not authenticated'}
                      highlight={sso.user_prt_present}
                    />
                    {sso.upn && <Row label="UPN" value={sso.upn} />}
                    {sso.tenant_id && <Row label="Tenant ID" value={sso.tenant_id} mono />}
                  </>
                )}
              </div>

              {/* Sign-in / sign-out controls */}
              {sso && !sso.user_prt_present && entraAuthEnabled && (
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={handleSignIn}
                    disabled={authPending}
                    className="w-full rounded-lg border px-3 py-2 text-sm font-medium bg-card hover:bg-muted transition-colors disabled:opacity-50"
                  >
                    {authPending ? 'Opening browser…' : 'Sign in with Microsoft'}
                  </button>
                  {authError && (
                    <p className="text-xs text-destructive px-0.5">{authError}</p>
                  )}
                </div>
              )}
              {sso?.source === 'cached' && sso.user_prt_present && (
                <button
                  type="button"
                  onClick={handleSignOut}
                  className="w-full rounded-lg border px-3 py-2 text-sm text-muted-foreground hover:bg-muted transition-colors"
                >
                  Sign out
                </button>
              )}
              {sso?.source === 'unavailable' && !entraAuthEnabled && (
                <p className="text-xs text-muted-foreground px-0.5">
                  Run <code className="font-mono bg-muted px-1 rounded">az login</code> to test SSO, or configure an Entra client ID in the bundle.
                </p>
              )}
            </section>
          </>
        )}
      </div>

      {(supportEmail || supportPhone) && (
        <footer className="border-t px-4 py-2 text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-1 shrink-0">
          {supportEmail && (
            <button type="button" onClick={() => openUrl(`mailto:${supportEmail}`)} className="hover:underline">
              {supportEmail}
            </button>
          )}
          {supportPhone && (
            <button type="button" onClick={() => openUrl(`tel:${supportPhone}`)} className="hover:underline">
              {supportPhone}
            </button>
          )}
        </footer>
      )}
    </main>
  );
}

function Row({ label, value, highlight, mono }: { label: string; value: string; highlight?: boolean; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center px-3 py-2 bg-card gap-4">
      <span className="text-muted-foreground shrink-0">{label}</span>
      <span className={`font-medium text-right truncate ${mono ? 'font-mono text-xs' : 'tabular-nums'} ${highlight ? 'text-green-600 dark:text-green-400' : ''}`}>
        {value}
      </span>
    </div>
  );
}
