import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ipc, type TicketSummary, type OsUser } from '@/lib/ipc';
import { logToFile } from '@/lib/file';
import { Button } from '@/ui/components/button';
import { Textarea } from '@/ui/components/textarea';
import { SubmitButton } from '@/ui/components/submit-button';
import Loader from '@/ui/components/loader';

function formatDate(iso: string) {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return iso;
  }
}

function NoteComposer({
  ticket,
  osUser,
  onDone,
}: {
  ticket: TicketSummary;
  osUser: OsUser | null;
  onDone: () => void;
}) {
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!note.trim()) return;
    setSubmitting(true);
    try {
      const ack = await ipc.addTicketNote(
        ticket.ticket_id,
        note.trim(),
        osUser?.username ?? 'End User',
        osUser?.sid ?? undefined
      );
      if (ack.accepted) {
        toast.success('Note added');
        setNote('');
        onDone();
      } else {
        toast.error(ack.message || 'Failed to add note');
      }
    } catch (err) {
      await logToFile('ERROR', `Add note error: ${err}`);
      toast.error('Failed to add note');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2 pt-2 border-t">
      <Textarea
        placeholder="Add a reply or update…"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        disabled={submitting}
        className="resize-none h-20 text-sm"
        autoFocus
      />
      <div className="flex gap-2">
        <SubmitButton pending={submitting} className="text-sm h-8">
          Send
        </SubmitButton>
        <Button type="button" variant="ghost" size="sm" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

export default function Tickets({
  accentColor,
  companyName,
}: {
  accentColor?: string;
  companyName?: string;
}) {
  const [tickets, setTickets] = useState<TicketSummary[]>([]);
  const [osUser, setOsUser] = useState<OsUser | null>(null);
  const [loading, setLoading] = useState(true);
  const [replyingTo, setReplyingTo] = useState<string | null>(null);

  const load = async () => {
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

  useEffect(() => {
    load();
  }, []);

  return (
    <main className="flex flex-col size-full overflow-hidden">
      <div
        className="flex items-center px-4 py-2 shrink-0"
        style={{ backgroundColor: accentColor ?? 'hsl(var(--primary))' }}
      >
        <span className="text-white font-semibold text-sm tracking-wide">
          {companyName ?? 'IT Support'} — My Tickets
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={load}
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
        ) : tickets.length === 0 ? (
          <div className="flex flex-1 items-center justify-center">
            <p className="text-sm text-muted-foreground">No tickets yet.</p>
          </div>
        ) : (
          tickets.map((t) => (
            <div key={t.id} className="border rounded-lg p-3 flex flex-col gap-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col gap-0.5 flex-1 min-w-0">
                  <p className="text-sm font-medium truncate">{t.summary}</p>
                  <p className="text-xs text-muted-foreground">
                    #{t.ticket_id} · {formatDate(t.created_at)}
                  </p>
                </div>
                {replyingTo !== t.id && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="text-xs h-7 shrink-0"
                    onClick={() => setReplyingTo(t.id)}
                  >
                    Reply
                  </Button>
                )}
              </div>

              {replyingTo === t.id && (
                <NoteComposer
                  ticket={t}
                  osUser={osUser}
                  onDone={() => setReplyingTo(null)}
                />
              )}
            </div>
          ))
        )}
      </div>
    </main>
  );
}
