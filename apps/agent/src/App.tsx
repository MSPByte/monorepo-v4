import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import Support from './Support';
import { ipc } from '@/lib/ipc';
import type { Bundle } from '@/lib/bundle';

type PushEventPayload =
  | { kind: 'bundle_updated'; etag?: string | null }
  | { kind: 'ticket_note_added'; ticket_id: string }
  | { kind: 'ticket_status_changed'; ticket_id: string; status_name: string };

export default function App() {
  const [bundle, setBundle] = useState<Bundle | null>(null);
  const [requestedFormId, setRequestedFormId] = useState<string | null>(null);
  const refreshingBundle = useRef(false);

  const refreshBundle = () => {
    if (refreshingBundle.current) return;
    refreshingBundle.current = true;
    ipc.getConfigBundle()
      .then(setBundle)
      .catch(() => null)
      .finally(() => { refreshingBundle.current = false; });
  };

  // Poll bundle on a slow interval as a safety net; WS push handles real-time.
  useEffect(() => {
    refreshBundle();
    const interval = window.setInterval(refreshBundle, 60_000);
    return () => window.clearInterval(interval);
  }, []);

  // Drain pending push events from agent-core every 5s.
  useEffect(() => {
    const poll = () => ipc.getPendingEvents().catch(() => null);
    const interval = window.setInterval(poll, 5_000);
    return () => window.clearInterval(interval);
  }, []);

  // React to WS push events emitted by the Rust side.
  useEffect(() => {
    const unlisten = listen<PushEventPayload>('push-event', ({ payload }) => {
      if (payload.kind === 'bundle_updated') {
        refreshBundle();
      }
      // ticket events are forwarded to Tickets.tsx via the same Tauri event
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, []);

  useEffect(() => {
    const unlistenForm = listen<string>('open_form', ({ payload }) => {
      setRequestedFormId(payload);
    });
    return () => {
      void unlistenForm.then((fn) => fn());
    };
  }, []);

  return (
    <div className="flex flex-col size-full">
      <div className="flex flex-col flex-1 min-h-0">
        <Support bundle={bundle} requestedFormId={requestedFormId} />
      </div>
    </div>
  );
}
