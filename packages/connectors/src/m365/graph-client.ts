import { z } from 'zod';

const TokenResponseSchema = z.object({
  access_token: z.string(),
  expires_in: z.number()
});

interface TokenEntry {
  token: string;
  expiresAt: number;
}

const RETRYABLE_STATUSES = new Set([429, 503, 504]);
const MAX_GRAPH_RETRIES = 3;
const DEFAULT_RETRY_DELAY_MS = 1_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(res: Response, attempt: number): number {
  const retryAfter = res.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

    const retryAt = Date.parse(retryAfter);
    if (!Number.isNaN(retryAt)) return Math.max(0, retryAt - Date.now());
  }

  return DEFAULT_RETRY_DELAY_MS * 2 ** attempt;
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
    M365GraphClient.tokenCache.delete(this.cacheKey());
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
    const res = await this.fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
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

  async patch(url: string, body: unknown): Promise<Response> {
    const token = await this.getToken();
    const res = await fetch(url, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph API PATCH error ${res.status}: ${url} – ${text}`);
    }
    return res;
  }

  async delete(url: string, opts?: { ignoreStatuses?: number[] }): Promise<Response> {
    const token = await this.getToken();
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (opts?.ignoreStatuses?.includes(res.status)) return res;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph API DELETE error ${res.status}: ${url} – ${text}`);
    }
    return res;
  }

  async postNoBody(url: string): Promise<Response> {
    const token = await this.getToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Graph API POST error ${res.status}: ${url} – ${text}`);
    }
    return res;
  }

  // Controlled primitive for reviewed OpenAPI operations. Callers receive the
  // same token handling and error normalization as the typed Graph methods;
  // URL selection stays in M365Connector, not in package capabilities.
  async request<T>(
    url: string,
    request: { method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; headers?: Record<string, string>; body?: unknown },
  ): Promise<{ data: T | undefined; res: Response }> {
    const token = await this.getToken();
    const headers = new Headers(request.headers);
    headers.set('Authorization', `Bearer ${token}`);
    if (request.body !== undefined) headers.set('Content-Type', 'application/json');
    const res = await fetch(url, {
      method: request.method,
      headers,
      body: request.body === undefined ? undefined : JSON.stringify(request.body),
    });
    if (res.status === 401) throw Object.assign(new Error('M365 auth rejected'), { failParent: true });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Graph API ${request.method} error ${res.status}: ${url} – ${body}`);
    }
    const text = await res.text();
    if (!text) return { data: undefined, res };
    try {
      return { data: JSON.parse(text) as T, res };
    } catch {
      return { data: text as T, res };
    }
  }

  private async fetchWithRetry(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; ; attempt++) {
      const res = await fetch(url, init);
      if (!RETRYABLE_STATUSES.has(res.status) || attempt >= MAX_GRAPH_RETRIES) return res;
      await sleep(retryDelayMs(res, attempt));
    }
  }

  // Yields each page of a Graph collection endpoint via @odata.nextLink. Use
  // this instead of getAll when the caller can process rows incrementally —
  // it avoids buffering the whole result set in memory for large tenants.
  async *pages<T>(
    url: string,
    opts?: { ignoreStatuses?: number[] }
  ): AsyncGenerator<T[], void, void> {
    const token = await this.getToken();
    let nextLink: string | null = url;
    while (nextLink) {
      const res = await this.fetchWithRetry(nextLink, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (opts?.ignoreStatuses?.includes(res.status)) return;
      if (res.status === 401) {
        throw Object.assign(new Error('M365 auth rejected'), { failParent: true });
      }
      if (!res.ok) {
        const body = await res.text();
        throw new Error(`Graph API error ${res.status}: ${nextLink} – ${body}`);
      }
      const body = (await res.json()) as { value?: T[]; '@odata.nextLink'?: string };
      if (Array.isArray(body.value) && body.value.length > 0) yield body.value;
      nextLink = body['@odata.nextLink'] ?? null;
    }
  }

  // Convenience wrapper: buffers all pages into one array. Prefer `pages()`
  // for large collections.
  async getAll<T>(url: string, opts?: { ignoreStatuses?: number[] }): Promise<T[]> {
    const items: T[] = [];
    for await (const page of this.pages<T>(url, opts)) items.push(...page);
    return items;
  }

  // Yields each page of a delta query. The final `return` value is the
  // deltaLink cursor to persist for the next incremental sync.
  async *deltaPages<T>(
    initialUrl: string,
    cursor?: string,
    opts?: { ignoreStatuses?: number[] }
  ): AsyncGenerator<T[], string | undefined, void> {
    const token = await this.getToken();
    let nextLink: string | null = cursor ?? initialUrl;
    let deltaLink: string | undefined;

    while (nextLink) {
      const res = await this.fetchWithRetry(nextLink, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (opts?.ignoreStatuses?.includes(res.status)) return deltaLink;
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
      if (Array.isArray(body.value) && body.value.length > 0) yield body.value;
      nextLink = body['@odata.nextLink'] ?? null;
      deltaLink = body['@odata.deltaLink'] ?? deltaLink;
    }

    return deltaLink;
  }

  async getDelta<T>(
    initialUrl: string,
    cursor?: string,
    opts?: { ignoreStatuses?: number[] }
  ): Promise<{ items: T[]; cursor?: string }> {
    const items: T[] = [];
    const gen = this.deltaPages<T>(initialUrl, cursor, opts);
    while (true) {
      const step = await gen.next();
      if (step.done) return { items, cursor: step.value };
      items.push(...step.value);
    }
  }
}
