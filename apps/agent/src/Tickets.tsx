import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { sendNotification } from '@tauri-apps/plugin-notification';
import { openUrl } from '@tauri-apps/plugin-opener';
import { toast } from 'sonner';
import { ipc, type TicketSummary, type OsUser, type TicketDetail, type NoteAttachment } from '@/lib/ipc';
import { logToFile, readFileBase64, chooseFileDialog, takeScreenshot } from '@/lib/file';
import { showWindow } from '@/lib/window';
import { Button } from '@/ui/components/button';
import { Textarea } from '@/ui/components/textarea';
import { SubmitButton } from '@/ui/components/submit-button';
import Loader from '@/ui/components/loader';

const MIME_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  csv: 'text/csv',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xls: 'application/vnd.ms-excel',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function mimeFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXT[ext] ?? 'application/octet-stream';
}

function formatDate(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return iso;
  }
}

function formatDateTime(iso: string) {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

type LocalAttachment = { name: string; mimeType: string; b64: string };

export default function Tickets({
  accentColor,
  companyName,
  logoUrl,
  supportEmail,
  supportPhone,
}: {
  accentColor?: string;
  companyName?: string;
  logoUrl?: string;
  supportEmail?: string;
  supportPhone?: string;
}) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [osUser, setOsUser] = useState<OsUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedTicket, setSelectedTicket] = useState<TicketSummary | null>(null);
  const [detail, setDetail] = useState<TicketDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [note, setNote] = useState('');
  const [attachments, setAttachments] = useState<LocalAttachment[]>([]);
  const [submitting, setSubmitting] = useState(false);

  const chatEndRef = useRef<HTMLDivElement>(null);

  const loadTickets = async () => {
    setLoading(true);
    try {
      const user = await ipc.getOsUser().catch(() => null);
      setOsUser(user);
      const result = await ipc.getTickets(user?.sid ?? undefined);
      setTickets(result.tickets ?? []);
    } catch (err) {
      await logToFile('WARN', `Load tickets error: ${err}`);
    } finally {
      setLoading(false);
    }
  };

  const loadDetail = async (ticketId: string, silent = false) => {
    if (!silent) {
      setLoadingDetail(true);
      setDetail(null);
    }
    try {
      const result = await ipc.getTicketDetail(ticketId);
      setDetail(result);
    } catch (err) {
      await logToFile('ERROR', `Load ticket detail error: ${err}`);
      if (!silent) toast.error('Failed to load ticket updates');
    } finally {
      if (!silent) setLoadingDetail(false);
    }
  };

  useEffect(() => {
    loadTickets();
  }, []);

  useEffect(() => {
    if (!selectedTicket) return;
    loadDetail(selectedTicket.ticket_id);
    const interval = setInterval(() => loadDetail(selectedTicket.ticket_id, true), 30_000);
    return () => clearInterval(interval);
  }, [selectedTicket]);

  // Auto-scroll to bottom when actions load
  useEffect(() => {
    if (detail && chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [detail]);

  // React to WS push events: refresh ticket list or open ticket detail immediately.
  useEffect(() => {
    type PushEvent =
      | { kind: 'ticket_note_added'; ticket_id: string }
      | { kind: 'ticket_status_changed'; ticket_id: string; status_name: string }
      | { kind: 'bundle_updated' };
    const unlisten = listen<PushEvent>('push-event', ({ payload }) => {
      if (payload.kind === 'ticket_note_added' || payload.kind === 'ticket_status_changed') {
        loadTickets();
        if (selectedTicket && selectedTicket.ticket_id === payload.ticket_id) {
          loadDetail(payload.ticket_id, true);
        } else {
          const body = payload.kind === 'ticket_status_changed'
            ? `Ticket #${payload.ticket_id} status changed to ${payload.status_name}`
            : `New reply on ticket #${payload.ticket_id}`;
          sendNotification({ title: 'Support Update', body });
        }
      }
    });
    return () => { void unlisten.then((fn) => fn()); };
  }, [selectedTicket]);

  const handleBack = () => {
    setSelectedTicket(null);
    setDetail(null);
    setNote('');
    setAttachments([]);
  };

  const handleAttachFile = async () => {
    const { data: path, error: fileError } = await chooseFileDialog();
    if (!path) {
      if (fileError && fileError.message !== 'No file selected.') {
        toast.error('Failed to open file dialog');
      }
      return;
    }
    const { data: b64, error } = await readFileBase64(path);
    if (!b64 || error) {
      toast.error(error?.message ?? 'Failed to read file');
      return;
    }
    const name = path.split(/[\\/]/).pop() ?? 'file';
    const mimeType = mimeFromPath(path);
    if (attachments.length >= 5) {
      toast.error('Maximum 5 attachments allowed');
      return;
    }
    setAttachments((prev) => [...prev, { name, mimeType, b64 }]);
  };

  const handleScreenshot = async () => {
    const { data: path, error } = await takeScreenshot();
    if (!path || error) {
      toast.error(error?.message ?? 'Failed to take screenshot');
      return;
    }
    await showWindow('tickets');
    const { data: b64 } = await readFileBase64(path);
    if (!b64) return;
    const name = path.split(/[\\/]/).pop() ?? 'screenshot.png';
    if (attachments.length >= 5) {
      toast.error('Maximum 5 attachments allowed');
      return;
    }
    setAttachments((prev) => [...prev, { name, mimeType: 'image/png', b64 }]);
  };

  const removeAttachment = (idx: number) => {
    setAttachments((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim() || !selectedTicket) return;
    setSubmitting(true);
    try {
      const noteAttachments: NoteAttachment[] = attachments.map((a) => ({
        name: a.name,
        mime_type: a.mimeType,
        data_b64: a.b64,
      }));
      const ack = await ipc.addTicketNote(
        selectedTicket.ticket_id,
        note.trim(),
        osUser?.username ?? 'End User',
        osUser?.sid ?? undefined,
        noteAttachments
      );
      if (ack.accepted) {
        toast.success('Reply sent');
        setNote('');
        setAttachments([]);
        await loadDetail(selectedTicket.ticket_id, true);
      } else {
        toast.error(ack.message || 'Failed to send reply');
      }
    } catch (err) {
      const message = typeof err === 'string' ? err : (err instanceof Error ? err.message : null);
      await logToFile('ERROR', `Send note error: ${message ?? String(err)}`);
      toast.error(message || 'Failed to send reply');
    } finally {
      setSubmitting(false);
    }
  };

  const headerBg = { backgroundColor: accentColor ?? 'hsl(var(--primary))' };

  // ─── Detail View ──────────────────────────────────────────────────────────────
  if (selectedTicket) {
    return (
      <main className="flex flex-col size-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center px-3 py-2 shrink-0 gap-2" style={headerBg}>
          <button
            onClick={handleBack}
            className="text-white/80 hover:text-white text-sm font-medium px-1"
          >
            ← Back
          </button>
          <span className="text-white font-semibold text-sm tracking-wide truncate flex-1">
            {selectedTicket.summary}
          </span>
        </div>

        {/* Chat timeline */}
        <div className="flex flex-col flex-1 overflow-y-auto min-h-0 p-3 gap-3">
          {loadingDetail ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader />
            </div>
          ) : !detail || detail.actions.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <p className="text-sm text-muted-foreground">No updates yet.</p>
            </div>
          ) : (
            detail.actions.map((action) => {
              const isAgent = action.is_agent;
              return (
                <div
                  key={action.id}
                  className={`flex flex-col gap-1 max-w-[80%] ${isAgent ? 'self-end items-end' : 'self-start items-start'}`}
                >
                  <span className="text-xs text-muted-foreground px-1">
                    {isAgent ? 'Support' : action.who}
                  </span>
                  <div
                    className={`rounded-lg px-3 py-2 text-sm [&_img]:max-w-full [&_img]:rounded [&_img]:mt-1 [&_p]:mb-1 last:[&_p]:mb-0 ${
                      isAgent
                        ? 'text-white'
                        : 'bg-muted text-foreground'
                    }`}
                    style={isAgent ? { backgroundColor: accentColor ?? 'hsl(var(--primary))' } : undefined}
                    dangerouslySetInnerHTML={{ __html: action.note_html || action.note }}
                  />
                  <span className="text-xs text-muted-foreground px-1">
                    {formatDateTime(action.created_at)}
                  </span>
                </div>
              );
            })
          )}
          <div ref={chatEndRef} />
        </div>

        {/* Reply composer */}
        <form onSubmit={handleSend} className="border-t p-3 flex flex-col gap-2 shrink-0">
          <Textarea
            placeholder="Write a reply…"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            disabled={submitting}
            className="resize-none h-20 text-sm"
          />
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((a, idx) => (
                <span
                  key={idx}
                  className="inline-flex items-center gap-1 bg-muted text-xs rounded-full px-2 py-0.5 max-w-[160px]"
                >
                  <span className="truncate">{a.name}</span>
                  <button
                    type="button"
                    onClick={() => removeAttachment(idx)}
                    className="text-muted-foreground hover:text-foreground shrink-0"
                    disabled={submitting}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleAttachFile}
              disabled={submitting || attachments.length >= 5}
              className="text-xs h-7"
            >
              Attach File
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleScreenshot}
              disabled={submitting || attachments.length >= 5}
              className="text-xs h-7"
            >
              Screenshot
            </Button>
            <SubmitButton
              pending={submitting}
              className="ml-auto text-xs h-7"
            >
              Send
            </SubmitButton>
          </div>
        </form>
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

  // ─── List View ────────────────────────────────────────────────────────────────
  return (
    <main className="flex flex-col size-full overflow-hidden">
      <div className="flex items-center px-4 py-2 shrink-0" style={headerBg}>
        {logoUrl && (
          <img
            src={logoUrl}
            alt=""
            className="size-6 rounded object-contain bg-white/10 mr-2"
          />
        )}
        <span className="text-white font-semibold text-sm tracking-wide">
          {companyName ?? 'IT Support'} — My Tickets
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={loadTickets}
          className="ml-auto text-white/80 hover:text-white hover:bg-white/10 h-7 text-xs"
        >
          Refresh
        </Button>
      </div>

      <div className="flex flex-col flex-1 overflow-y-auto min-h-0 p-3 gap-2">
        {loading ? (
          <div className="flex flex-1 items-center justify-center">
            <Loader />
          </div>
        ) : tickets.filter((t) => t.is_open !== false).length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">No open tickets.</p>
          </div>
        ) : (
          tickets
            .filter((t) => t.is_open !== false)
            .map((t) => (
              <button
                key={t.id}
                onClick={() => setSelectedTicket(t)}
                className="border rounded-lg p-3 flex items-center gap-2 text-left hover:bg-accent transition-colors w-full"
              >
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    #{t.ticket_id} · {formatDate(t.created_at)}
                  </p>
                </div>
                {t.status_name && (
                  <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400">
                    {t.status_name}
                  </span>
                )}
                <span className="text-muted-foreground shrink-0 text-base leading-none">›</span>
              </button>
            ))
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
