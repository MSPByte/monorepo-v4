const DEFAULT_TTL_S = 55 * 60;

interface TokenEntry {
  token: string;
  expiresAt: number;
}

// Process-level token cache keyed by `${url}::${clientId}::halopsa`
const tokenCache = new Map<string, Promise<TokenEntry>>();

function tokenCacheKey(url: string, clientId: string): string {
  return `${url}::${clientId}::halopsa`;
}

export class HaloPSAHttpClient {
  constructor(
    readonly baseUrl: string,
    private readonly clientId: string,
    private readonly clientSecret: string
  ) {}

  async getToken(): Promise<string> {
    const key = tokenCacheKey(this.baseUrl, this.clientId);
    const cached = tokenCache.get(key);
    if (cached) {
      const entry = await cached;
      if (Date.now() < entry.expiresAt) return entry.token;
      tokenCache.delete(key);
    }
    const pending = this.fetchToken();
    tokenCache.set(key, pending);
    pending.catch(() => tokenCache.delete(key));
    return (await pending).token;
  }

  private async fetchToken(): Promise<TokenEntry> {
    const res = await fetch(`${this.baseUrl}/auth/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: 'all'
      })
    });

    if (!res.ok) {
      throw new Error(`HaloPSA token error: HTTP ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as { access_token: string; expires_in?: number };
    const expiresIn = data.expires_in ?? DEFAULT_TTL_S;
    return {
      token: data.access_token,
      expiresAt: Date.now() + (expiresIn - 30) * 1000
    };
  }

  async get<T>(path: string): Promise<T> {
    const token = await this.getToken();
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    if (!res.ok) {
      throw new Error(`HaloPSA GET error: HTTP ${res.status} ${res.statusText} — ${url}`);
    }

    return res.json() as Promise<T>;
  }

  async post<T>(path: string, body: unknown, contentType = 'application/json'): Promise<T> {
    const token = await this.getToken();
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': contentType },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      throw new Error(`HaloPSA POST error: HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    return res.json() as Promise<T>;
  }

  async postForm(path: string, body: FormData): Promise<Response> {
    const token = await this.getToken();
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body
    });
    if (!res.ok) {
      throw new Error(`HaloPSA postForm error: HTTP ${res.status} ${res.statusText} — ${url}`);
    }
    return res;
  }

  // Page-number pagination: fetches first page, then continues while items.length < record_count.
  // `key` is the response body field that contains the array (e.g. 'sites', 'assets', 'users').
  async getAll<T>(path: string, key: string, params: URLSearchParams): Promise<T[]> {
    type PagedResponse = { record_count: number; page_no: number } & Record<string, T[]>;

    const items: T[] = [];
    const first = await this.get<PagedResponse>(`${path}?${params}`);
    const pageItems = first[key];
    if (Array.isArray(pageItems)) items.push(...pageItems);

    params.set('page_no', String(first.page_no + 1));
    while (items.length < first.record_count) {
      const page = await this.get<PagedResponse>(`${path}?${params}`);
      const batch = page[key];
      if (Array.isArray(batch)) items.push(...batch);
      else break;
      params.set('page_no', String(page.page_no + 1));
    }

    return items;
  }
}
