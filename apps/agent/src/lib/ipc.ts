import { invoke } from '@tauri-apps/api/core';
import type { Bundle } from './bundle';

export type AgentStatus = {
  enrolled: boolean;
  version: string;
  device_id: string | null;
  bundle_etag: string | null;
  bundle_offline: boolean;
};

export type OsUser = {
  username: string;
  sid: string | null;
  display_name: string | null;
};

export type TicketSummary = {
  id: string;
  ticket_id: string;
  summary: string;
  created_at: string;
  status_id: number | null;
  status_name: string | null;
  is_open: boolean | null;
};

export type Attachment = {
  field_id: string;
  name: string;
  mime_type: string;
  data_b64: string;
};

export type SubmitFormPayload = {
  form_id: string;
  form_version_id: string;
  answers: Record<string, string>;
  os_user: OsUser;
  attachments: Attachment[];
};

export type SubmitFormAck = {
  accepted: boolean;
  message: string;
  submission_id: string | null;
};

export type TicketNoteAck = {
  accepted: boolean;
  message: string;
};

export type TicketAction = {
  id: string;
  note_html: string;
  note: string;
  who: string;
  is_agent: boolean;
  created_at: string;
};

export type TicketDetail = {
  ticket_id: string;
  actions: TicketAction[];
};

export type NoteAttachment = {
  name: string;
  mime_type: string;
  data_b64: string;
};

async function wrapInvoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return invoke<T>(cmd, args);
}

export const ipc = {
  getAgentStatus: () => wrapInvoke<AgentStatus>('get_agent_status'),

  getConfigBundle: async (): Promise<Bundle | null> => {
    const result = await wrapInvoke<{ bundle: unknown | null }>('get_config_bundle');
    return (result.bundle as Bundle) ?? null;
  },

  getOsUser: () => wrapInvoke<OsUser>('get_os_user'),

  submitForm: (payload: SubmitFormPayload) =>
    wrapInvoke<SubmitFormAck>('submit_form', { payload }),

  getTickets: (osSid?: string) =>
    wrapInvoke<{ tickets: TicketSummary[] }>('get_tickets', { osUserSid: osSid ?? null }),

  addTicketNote: (ticketId: string, note: string, osUsername: string, osSid?: string, attachments?: NoteAttachment[]) =>
    wrapInvoke<TicketNoteAck>('add_ticket_note', {
      ticketId,
      note,
      osUsername,
      osUserSid: osSid ?? null,
      attachments: attachments ?? [],
    }),

  getTicketDetail: (ticketId: string) =>
    wrapInvoke<TicketDetail>('get_ticket_detail', { ticketId }),

  getPendingEvents: () =>
    wrapInvoke<void>('get_pending_events'),
};
