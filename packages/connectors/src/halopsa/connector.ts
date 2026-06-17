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

// ─── Connector ────────────────────────────────────────────────────────────────

export class HaloPSAConnector {
  private client: HaloPSAHttpClient;

  readonly site: {
    list: () => Promise<HaloPSASite[]>;
  };

  readonly asset: {
    list: (siteId: string) => Promise<HaloPSAAsset[]>;
  };

  readonly users: {
    get: (email?: string) => Promise<HaloPSAUser>;
  };

  readonly tickets: {
    create: (body: HaloPSATicketBody) => Promise<string>;
  };

  readonly attachment: {
    uploadImage: (file: Blob) => Promise<string>;
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
      }
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
