import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { getSystemInfo, type SystemInfo } from '@/lib/agent';
import Loader from '@/ui/components/loader';
import { ipc } from '@/lib/ipc';
import type { Bundle } from '@/lib/bundle';

export default function About() {
  const [info, setInfo] = useState<SystemInfo | undefined>(undefined);
  const [bundle, setBundle] = useState<Bundle | null>(null);

  useEffect(() => {
    getSystemInfo().then((r) => setInfo(r.data)).catch(() => null);
    const refresh = () => ipc.getConfigBundle().then(setBundle).catch(() => null);
    refresh();
    const interval = window.setInterval(refresh, 10_000);
    return () => window.clearInterval(interval);
  }, []);

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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between items-center px-3 py-2 bg-card">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}
