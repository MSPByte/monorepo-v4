import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import Tickets from './Tickets';
import { ipc } from './lib/ipc';
import type { Bundle } from './lib/bundle';
import { Toaster } from '@/ui/components/sonner';
import './styles/globals.css';

function TicketsWindow() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  useEffect(() => {
    const refreshBundle = () => ipc.getConfigBundle().then(setBundle).catch(() => null);
    refreshBundle();
    const interval = window.setInterval(refreshBundle, 10_000);
    return () => window.clearInterval(interval);
  }, []);
  return (
    <Tickets
      accentColor={bundle?.branding.primaryColor}
      companyName={bundle?.branding.appName}
      logoUrl={bundle?.branding.logoUrl}
      supportEmail={bundle?.branding.supportEmail}
      supportPhone={bundle?.branding.supportPhone}
    />
  );
}

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode><TicketsWindow /><Toaster position="bottom-right" /></React.StrictMode>
);
