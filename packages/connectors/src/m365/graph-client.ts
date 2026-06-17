import { z } from 'zod';

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number()
});

interface TokenEntry {
  token: string;
  expiresAt: number;
}

export class M365GraphClient {
  // Process-level cache keyed by `${clientId}::${tenantId}`.
  // Stores the in-flight Promise so concurrent callers share one auth request.
  private static tokenCache = new Map<string, Promise<TokenEntry>>();

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly tenantId: string
  ) {}

  private cacheKey(): string {
    return `${this.clientId}::${this.tenantId}`;
  }

  clearCache() {
    M365GraphClient.tokenCache.clear();
  }

  async getToken(): Promise<string> {
    const key = this.cacheKey();
    const cached = M365GraphClient.tokenCache.get(key);
    if (cached) {
      const entry = await cached;
      if (Date.now() < entry.expiresAt) return entry.token;
      M365GraphClient.tokenCache.delete(key);
    }
    const pending = this.fetchToken();
    M365GraphClient.tokenCache.set(key, pending);
    pending.catch(() => M365GraphClient.tokenCache.delete(key));
    return (await pending).token;
  }

  private async fetchToken(): Promise<TokenEntry> {
    const res = await fetch(
      `https://login.microsoftonline.com/${this.tenantId}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          client_id: this.clientId,
          client_secret: this.clientSecret,
          scope: 'https://graph.microsoft.com/.default'
        })
      }
    );
    if (res.status === 401) {
      throw Object.assign(new Error(`M365 auth rejected for tenant ${this.tenantId}`), {
        failParent: true
      });
    }
    if (!res.ok) throw new Error(`M365 token endpoint error: ${res.status}`);
    const data = TokenResponseSchema.parse(await res.json());
    return {
      token: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 300) * 1000
    };
  }

  async get<T>(url: string): Promise<{ data: T; res: Response }> {
    const token = await this.getToken();
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    if (res.status === 401) {
      throw Object.assign(new Error('M365 auth rejected'), { failParent: true });
    }
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Graph API error ${res.status}: ${url} – ${body}`);
    }
    return { data: (await res.json()) as T, res };
  }

  async post<T>(url: string, body: unknown): Promise<{ data: T; res: Response }> {
    const token = await this.getToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Graph API POST error ${res.status}: ${url} – ${body}`);
    }
    return { data: (await res.json()) as T, res };
  }

  // Fetches all pages of a Graph collection endpoint via @odata.nextLink.
  // If the response status is in ignoreStatuses, returns items collected so far ([] if first page).
  async getAll<T>(url: string, opts?: { ignoreStatuses?: number[] }): Promise<T[]> {
    const token = await this.getToken();
    const items: T[] = [];
    let nextLink: string | null = url;
    while (nextLink) {
      const res = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } });
      if (opts?.ignoreStatuses?.includes(res.status)) return items;
      if (res.status === 401) {
        throw Object.assign(new Error('M365 auth rejected'), { failParent: true });
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Graph API error ${res.status}: ${nextLink} – ${body}`);
      }
      const body = (await res.json()) as { value?: T[]; '@odata.nextLink'?: string };
      if (Array.isArray(body.value)) items.push(...body.value);
      nextLink = body['@odata.nextLink'] ?? null;
    }
    return items;
  }

  async getDelta<T>(
    initialUrl: string,
    cursor?: string,
    opts?: { ignoreStatuses?: number[] }
  ): Promise<{ items: T[]; cursor?: string }> {
    const token = await this.getToken();
    const items: T[] = [];
    let nextLink: string | null = cursor ?? initialUrl;
    let deltaLink: string | undefined;

    while (nextLink) {
      const res = await fetch(nextLink, { headers: { Authorization: `Bearer ${token}` } });
      if (opts?.ignoreStatuses?.includes(res.status)) return { items, cursor: deltaLink };
      if (res.status === 401) {
        throw Object.assign(new Error('M365 auth rejected'), { failParent: true });
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Graph API error ${res.status}: ${nextLink} – ${body}`);
      }
      const body = (await res.json()) as {
        value?: T[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      };
      if (Array.isArray(body.value)) items.push(...body.value);
      nextLink = body['@odata.nextLink'] ?? null;
      deltaLink = body['@odata.deltaLink'] ?? deltaLink;
    }

    return { items, cursor: deltaLink };
  }
}
