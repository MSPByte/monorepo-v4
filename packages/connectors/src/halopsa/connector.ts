import { z } from 'zod';
import { HaloPSAHttpClient } from './http-client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface HaloPSASite {
  id: number;
  name: string;
  client_id: number;
  client_name: string;
  clientsite_name: string;
  inactive: boolean;
  sla_id: number;
  phonenumber: string;
  colour: string;
  timezone: string;
  invoice_address_isdelivery: boolean;
  isstocklocation: boolean;
  messagegroup_id: number;
  use: string;
  site_fields: unknown[];
  itglue_id: string;
  maincontact_id: number;
  isinvoicesite: boolean;
  site_item_tax_code: number;
  default_currency_code: number;
  default_client_currency_code: number;
}

export interface HaloPSAAsset {
  id: number;
  changeguid: string;
  inventory_number: string;
  key_field: string;
  key_field2: string;
  key_field3: string;
  client_id: number;
  client_name: string;
  site_id: number;
  site_name: string;
  assettype_id: number;
  assettype_name: string;
  inactive: boolean;
  datto_id: string;
  datto_alternate_id: number;
  ninjarmm_id: number;
  automate_id: number;
  username: string;
  status_id: number;
  [key: string]: unknown;
}

export interface HaloPSAUser {
  id: number;
  name?: string;
  site_id?: number;
  site_name?: string;
  client_name?: string;
  firstname?: string;
  surname?: string;
  emailaddress?: string;
  inactive?: boolean;
  [key: string]: unknown;
}

export interface HaloPSATicketBody {
  site_id?: number;
  priority_id: number;
  files: null;
  usertype: number;
  user_id?: number;
  reportedby: string;
  tickettype_id: number;
  timerinuse: boolean;
  itil_tickettype_id: string;
  tickettype_group_id: string;
  summary: string;
  details_html: string;
  category_1: string;
  impact: string;
  urgency: string;
  donotapplytemplateintheapi: boolean;
  utcoffset: number;
  form_id: string;
  dont_do_rules: boolean;
  return_this: boolean;
  phonenumber: string;
  assets: { id: number }[];
}

export interface HaloPSANewTicket {
  siteId?: number;
  clientId?: number;
  summary: string;
  details: string;
  user: { id?: number; name: string; email: string; phone: string };
  impact: string;
  urgency: string;
  deviceName: string;
  assets: number[];
  images: string[];
}

export type HaloPSARecurringInvoice = Record<string, unknown> & {
  id?: number | string;
  client_id?: number | string;
  client_name?: string;
  site_id?: number | string;
  site_name?: string;
};

// Normalized shape for enum-style lookups (priorities, ticket types, statuses,
// categories). Halo returns richer objects — we surface only the fields the
// package builder needs to render a dropdown and persist a selection.
export interface HaloPSALookupOption {
  id: number;
  name: string;
}

// Minimum-viable action payload — Halo accepts many more fields but these
// cover the log-time / add-note flows the packages system currently drives.
// Time is passed in decimal hours; the log-time capability converts minutes.
export interface HaloPSATicketSummary {
  id: number;
  summary: string;
  status_id: number;
  status: string;
}

export interface HaloPSAActionBody {
  ticket_id: number;
  actiontype_id?: number;
  outcome?: string;
  outcome_id?: number;
  note?: string;
  note_html?: string;
  timetaken?: number;
  actionchargable?: boolean;
  actiondatecreated?: string;
  who?: string;
  who_agentid?: number;
  utcoffset?: number;
  sendemail?: boolean;
  hiddenfromuser?: boolean;
}

export interface HaloPSAActionDetail {
  id: number;
  ticket_id: number;
  note_html: string;
  note: string;
  who: string;
  who_agentid: number;
  hiddenfromuser: boolean;
  actiondatecreated: string;
  outcome: string;
}

// ─── Connector ────────────────────────────────────────────────────────────────

export class HaloPSAConnector {
  private client: HaloPSAHttpClient;

  readonly site: {
    list: () => Promise<HaloPSASite[]>;
    get: (id: string | number) => Promise<HaloPSASite>;
  };

  readonly asset: {
    list: (siteId: string) => Promise<HaloPSAAsset[]>;
  };

  readonly users: {
    get: (email?: string) => Promise<HaloPSAUser>;
  };

  readonly tickets: {
    create: (body: HaloPSATicketBody) => Promise<string>;
    get: (id: string | number) => Promise<HaloPSATicketSummary>;
    update: (id: string | number, fields: { status_id?: number }) => Promise<void>;
  };

  readonly actions: {
    create: (body: HaloPSAActionBody) => Promise<string>;
    list: (ticketId: string | number) => Promise<HaloPSAActionDetail[]>;
  };

  readonly priorities: {
    list: () => Promise<HaloPSALookupOption[]>;
  };

  readonly ticketTypes: {
    list: () => Promise<HaloPSALookupOption[]>;
  };

  readonly categories: {
    list: () => Promise<HaloPSALookupOption[]>;
  };

  readonly attachment: {
    uploadImage: (file: Blob) => Promise<string>;
  };

  readonly recurringInvoice: {
    list: (params?: {
      siteId?: string | number;
      clientId?: string | number;
      includeLines?: boolean;
      fullObjects?: boolean;
    }) => Promise<HaloPSARecurringInvoice[]>;
    get: (id: string | number, includeLines?: boolean) => Promise<HaloPSARecurringInvoice>;
  };

  constructor(url: string, clientId: string, clientSecret: string) {
    this.client = new HaloPSAHttpClient(url, clientId, clientSecret);

    this.site = {
      list: () => {
        const params = new URLSearchParams({
          exclude_internal: 'false',
          includeserviceaccount: 'true',
          includenonserviceaccount: 'true',
          includeinactive: 'false',
          includecolumns: 'false',
          showcounts: 'true',
          paginate: 'true',
          page_size: '50',
          page_no: '1'
        });
        return this.client.getAll<HaloPSASite>('/api/site', 'sites', params);
      },
      get: (id) => this.client.get<HaloPSASite>(`/api/site/${id}`)
    };

    this.asset = {
      list: (siteId) => {
        const params = new URLSearchParams({
          cf_display_values_only: 'true',
          includeinactive: 'false',
          site_id: siteId,
          includecolumns: 'false',
          showcounts: 'true',
          paginate: 'true',
          page_size: '50',
          page_no: '1'
        });
        return this.client.getAll<HaloPSAAsset>('/api/asset', 'assets', params);
      }
    };

    this.users = {
      get: async (email?) => {
        const params = new URLSearchParams({
          cf_display_values_only: 'true',
          includeinactive: 'false',
          includecolumns: 'false',
          showcounts: 'true',
          paginate: 'true',
          page_size: '50',
          page_no: '1'
        });
        if (email) params.set('search', email);

        type Response = { users: HaloPSAUser[] };
        const data = await this.client.get<Response>(`/api/users?${params}`);
        const first = data.users[0];
        if (!first) throw new Error('HaloPSAConnector.users.get: no user found');
        return first;
      }
    };

    this.tickets = {
      create: async (body) => {
        const params = new URLSearchParams({
          includedetails: 'false',
          includetickettype: 'false',
          includeuser: 'false',
          includepriority: 'false',
          idonly: 'true'
        });
        const data = await this.client.post<{ id: string }>(
          `/api/tickets?${params}`,
          [body],
          'application/json-patch+json'
        );
        return String(data.id);
      },
      get: async (id) => {
        const data = await this.client.get<unknown>(`/api/tickets/${id}`);
        // HaloPSA may return { tickets: [ticket] } or the ticket object directly.
        const ticket: Record<string, unknown> = (
          isRecord(data) && Array.isArray((data as any).tickets)
            ? (data as any).tickets[0]
            : data
        ) as Record<string, unknown>;
        return {
          id: Number(ticket.id),
          summary: String(ticket.summary ?? ''),
          status_id: Number(ticket.status_id ?? 0),
          status: String(ticket.status ?? ticket.statusname ?? ticket.status_name ?? ''),
        };
      },
      update: async (id, fields) => {
        await this.client.post(
          '/api/tickets',
          [{ id: Number(id), ...fields }],
          'application/json-patch+json'
        );
      },
    };

    this.actions = {
      create: async (body) => {
        const params = new URLSearchParams({ idonly: 'true' });
        // Halo's /api/actions accepts an array and returns the created action.
        // Response shape varies (bare object vs { id } vs first-of-array), so
        // pick the id defensively.
        const data = await this.client.post<unknown>(
          `/api/actions?${params}`,
          [body],
          'application/json-patch+json'
        );
        const id = pickHaloActionId(data);
        if (id == null) throw new Error('HaloPSAConnector.actions.create: no id in response');
        return String(id);
      },
      list: async (ticketId) => {
        const params = new URLSearchParams({
          ticket_id: String(ticketId),
          includedetails: 'true',
        });
        type Response = { actions: HaloPSAActionDetail[] };
        const data = await this.client.get<Response>(`/api/actions?${params}`);
        return Array.isArray(data.actions) ? data.actions : [];
      }
    };

    // Enum lookups feed the package builder / run dialog dropdowns. Halo's
    // list endpoints return unwrapped arrays (unlike /api/site which nests).
    // We coerce loose IDs to numbers and pick the display name from either
    // `name` or `value` (categories use `value`).
    this.priorities = {
      list: async () => {
        const data = await this.client.get<unknown>('/api/priority');
        return normalizeHaloLookupList(data, ['priorities']);
      }
    };

    this.ticketTypes = {
      list: async () => {
        const data = await this.client.get<unknown>('/api/tickettype');
        return normalizeHaloLookupList(data, ['tickettypes', 'ticket_types']);
      }
    };

    this.categories = {
      list: async () => {
        // type_id=1 filters to top-level ticket categories (category_1), which
        // is the field the create-ticket capability writes to.
        const data = await this.client.get<unknown>('/api/category?type_id=1');
        return normalizeHaloLookupList(data, ['categories']);
      }
    };

    this.attachment = {
      uploadImage: async (file) => {
        const formData = new FormData();
        formData.append('ticket_id', '');
        formData.append('image_upload_id', '0');
        formData.append('image_upload_key', '');
        formData.append('file', file, 'upload.png');
        const res = await this.client.postForm('/api/attachment/image', formData);
        const data = z.object({ link: z.string() }).parse(await res.json());
        return data.link;
      }
    };

    this.recurringInvoice = {
      list: async (options = {}) => {
        // Mirror the query used by HaloPSA's own client-invoices UI so we get invoices + credits,
        // including inactive ones, and the same field set.
        const params = new URLSearchParams({
          paginate: 'true',
          page_size: '50',
          page_no: '1',
          includeinactive: 'true',
          includeinvoices: 'true',
          includecredits: 'true',
          includepoinvoices: 'false'
        });
        if (options.siteId != null) {
          params.set('site_id', String(options.siteId));
        }
        if (options.clientId != null) {
          params.set('client_id', String(options.clientId));
        }
        if (options.includeLines ?? true) {
          params.set('includelines', 'true');
        }

        const invoices = await this.getRecurringInvoicePages(params);
        if (!options.fullObjects) return invoices;

        return Promise.all(
          invoices.map((invoice) =>
            invoice.id == null
              ? invoice
              : this.recurringInvoice.get(invoice.id, options.includeLines ?? true)
          )
        );
      },
      get: async (id, includeLines = true) => {
        const params = new URLSearchParams();
        if (includeLines) {
          params.set('includelines', 'true');
          params.set('include_lines', 'true');
        }
        const suffix = params.size ? `?${params}` : '';
        const data = await this.client.get<Record<string, unknown>>(
          `/api/RecurringInvoice/${id}${suffix}`
        );
        return firstRecurringInvoice(data) ?? (data as HaloPSARecurringInvoice);
      }
    };
  }

  private async getRecurringInvoicePages(
    params: URLSearchParams
  ): Promise<HaloPSARecurringInvoice[]> {
    type PagedResponse = {
      record_count?: number;
      page_no?: number;
      count?: number;
      total?: number;
    } & Record<string, unknown>;

    const items: HaloPSARecurringInvoice[] = [];
    const first = await this.client.get<PagedResponse>(`/api/RecurringInvoice?${params}`);
    items.push(...recurringInvoiceItems(first));

    const total = Number(first.record_count);
    params.set('page_no', String(Number(first.page_no ?? 1) + 1));

    while (items.length < total) {
      const page = await this.client.get<PagedResponse>(`/api/RecurringInvoice?${params}`);
      const batch = recurringInvoiceItems(page);
      if (batch.length === 0) break;
      items.push(...batch);
      params.set('page_no', String(Number(page.page_no ?? Number(params.get('page_no'))) + 1));
    }

    return items;
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.client.getToken();
      return true;
    } catch {
      return false;
    }
  }
}

function firstRecurringInvoice(value: unknown): HaloPSARecurringInvoice | null {
  const items = recurringInvoiceItems(value);
  return items[0] ?? null;
}

function recurringInvoiceItems(value: unknown): HaloPSARecurringInvoice[] {
  if (Array.isArray(value)) return value.filter(isRecord) as HaloPSARecurringInvoice[];
  if (!isRecord(value)) return [];

  for (const key of [
    'invoices',
    'recurringinvoices',
    'recurring_invoices',
    'recurringInvoices',
    'results',
    'data'
  ]) {
    const maybeItems = value[key];
    if (Array.isArray(maybeItems)) return maybeItems.filter(isRecord) as HaloPSARecurringInvoice[];
  }

  const fallback = Object.values(value).find(
    (entry) => Array.isArray(entry) && entry.some(isRecord)
  );
  return Array.isArray(fallback) ? (fallback.filter(isRecord) as HaloPSARecurringInvoice[]) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function pickHaloActionId(value: unknown): string | number | null {
  const candidate = Array.isArray(value) ? value[0] : value;
  if (!isRecord(candidate)) return null;
  const raw = candidate.id ?? candidate.actionid ?? candidate.action_id;
  if (raw == null) return null;
  return typeof raw === 'number' || typeof raw === 'string' ? raw : null;
}

// Halo lookup endpoints sometimes return a bare array and sometimes wrap it
// under a resource-specific key (e.g. `{ categories: [...] }`). Pick either
// and coerce to `{id, name}` — dropping entries that don't have both.
function normalizeHaloLookupList(
  value: unknown,
  wrapKeys: readonly string[]
): HaloPSALookupOption[] {
  let items: unknown[] = [];
  if (Array.isArray(value)) {
    items = value;
  } else if (isRecord(value)) {
    for (const key of wrapKeys) {
      const nested = value[key];
      if (Array.isArray(nested)) {
        items = nested;
        break;
      }
    }
  }
  const out: HaloPSALookupOption[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const idRaw = raw.id;
    const id = typeof idRaw === 'number' ? idRaw : Number(idRaw);
    if (!Number.isFinite(id)) continue;
    const nameRaw = raw.name ?? raw.value ?? raw.display_name;
    const name = typeof nameRaw === 'string' ? nameRaw : String(nameRaw ?? '');
    if (!name) continue;
    out.push({ id, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}
