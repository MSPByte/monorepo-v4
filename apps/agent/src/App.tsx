import { useEffect, useState } from 'react';
import Support from './Support';
import Tickets from './Tickets';
import { ipc } from '@/lib/ipc';
import type { Bundle } from '@/lib/bundle';

type Tab = 'support' | 'tickets';

export default function App() {
  const [tab, setTab] = useState<Tab>('support');
  const [bundle, setBundle] = useState<Bundle | null>(null);

  useEffect(() => {
    ipc.getConfigBundle().then(setBundle).catch(() => null);
  }, []);

  const accent = bundle?.branding?.accentColor;
  const company = bundle?.branding?.companyName;

  const tabClass = (t: Tab) =>
    `flex-1 py-1.5 text-xs font-medium transition-colors border-b-2 ${
      tab === t
        ? 'border-primary text-primary'
        : 'border-transparent text-muted-foreground hover:text-foreground'
    }`;

  return (
    <div className="flex flex-col size-full">
      {/* Tab bar */}
      <div className="flex border-b shrink-0">
        <button className={tabClass('support')} onClick={() => setTab('support')}>
          New Ticket
        </button>
        <button className={tabClass('tickets')} onClick={() => setTab('tickets')}>
          My Tickets
        </button>
      </div>

      <div className="flex flex-col flex-1 min-h-0">
        {tab === 'support' ? (
          <Support />
        ) : (
          <Tickets accentColor={accent} companyName={company} />
        )}
      </div>
    </div>
  );
}
