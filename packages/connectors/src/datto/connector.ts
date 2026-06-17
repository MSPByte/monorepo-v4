import { DattoHttpClient } from './http-client.js';

const MAX_PAGES = 500;

type PagedResponse<TKey extends string, TItem> = {
  [K in TKey]: TItem[];
} & { pageDetails?: { nextPageUrl?: string } };

export interface DattoSite {
  id: number;
  uid: string;
  name: string;
  siteCode?: string;
  description?: string;
}

export interface DattoDevice {
  id: number;
  uid: string;
  hostname: string;
  online: boolean;
  operatingSystem?: string | null;
  deviceType?: { category: string; type: string };
  intIpAddress?: string;
  extIpAddress?: string | null;
  lastSeen?: number | null;
  lastReboot?: number | null;
  udf?: Record<string, string | null | undefined>;
}

export class DattoConnector {
  private client: DattoHttpClient;

  readonly site: {
    devices: (siteUid: string) => Promise<DattoDevice[]>;
    variables: {
      get: (siteUid: string, variableName: string) => Promise<string | null>;
      set: (siteUid: string, variableName: string, value: string) => Promise<void>;
    };
  };

  readonly account: {
    sites: () => Promise<DattoSite[]>;
  };

  constructor(url: string, apiKey: string, apiSecretKey: string) {
    this.client = new DattoHttpClient(url, apiKey, apiSecretKey);

    this.site = {
      devices: (siteUid) => this.fetchPaged<DattoDevice, 'devices'>(`/api/v2/site/${siteUid}/devices`, 'devices'),
      variables: {
        get: async (siteUid, variableName) => {
          const data = await this.client.getOrNull<{
            variables: { id: string; name: string; value: string; masked: boolean }[];
          }>(`/api/v2/site/${siteUid}/variables`);
          if (!data) return null;
          return data.variables.find((v) => v.name === variableName)?.value ?? null;
        },
        set: async (siteUid, variableName, value) => {
          const data = await this.client.getOrNull<{ variables: { id: string; name: string }[] }>(
            `/api/v2/site/${siteUid}/variables`
          );
          const variableId = data?.variables.find((v) => v.name === variableName)?.id ?? null;
          if (variableId) {
            await this.client.post(`/api/v2/site/${siteUid}/variable/${variableId}`, { name: variableName, value });
          } else {
            await this.client.put(`/api/v2/site/${siteUid}/variable`, { name: variableName, value });
          }
        },
      },
    };

    this.account = {
      sites: () => this.fetchPaged<DattoSite, 'sites'>('/api/v2/account/sites', 'sites')
    };
  }

  async checkHealth(): Promise<boolean> {
    try {
      await this.client.get('/api/v2/account/sites?_perPage=1');
      return true;
    } catch {
      return false;
    }
  }

  private async fetchPaged<T, TKey extends string>(
    path: string,
    key: TKey
  ): Promise<T[]> {
    const items: T[] = [];
    let nextUrl: string | null = path;
    const seenUrls = new Set<string>();
    let pageCount = 0;

    while (nextUrl) {
      if (seenUrls.has(nextUrl)) {
        throw new Error(`DattoRMM pagination loop detected at ${nextUrl}`);
      }
      if (pageCount >= MAX_PAGES) {
        throw new Error(`DattoRMM pagination exceeded ${MAX_PAGES} pages for ${path}`);
      }

      seenUrls.add(nextUrl);
      pageCount++;

      const page: PagedResponse<TKey, T> = await this.client.get<PagedResponse<TKey, T>>(nextUrl);
      const pageItems = page[key];
      if (Array.isArray(pageItems)) items.push(...pageItems);
      nextUrl = page.pageDetails?.nextPageUrl ?? null;
    }
    return items;
  }
}
