import { fetchWithRetry } from "../fetch.js";

const TOKEN_URL = "https://id.sophos.com/api/v2/oauth2/token";

interface TokenEntry {
  token: string;
  expiresAt: number;
}

export type SophosRequestOptions = {
  partnerId?: string;
};

type SophosPagedResponse<T> = {
  items: T[];
  pages: {
    total: number;
    current: number;
  };
};

type FetchInput = Parameters<typeof fetch>[0];

// Process-level token cache keyed by `${clientId}::sophos`
const tokenCache = new Map<string, Promise<TokenEntry>>();

function tokenCacheKey(clientId: string): string {
  return `${clientId}::sophos`;
}

function inputLabel(input: FetchInput): string {
  return typeof input === "string" ? input : input.toString();
}

export class SophosHttpClient {
  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async getToken(): Promise<string> {
    const key = tokenCacheKey(this.clientId);
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
    const res = await this.fetchRateLimitAware(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "client_credentials",
        client_id: this.clientId,
        client_secret: this.clientSecret,
        scope: "token",
      }),
    });

    if (res.status === 401) {
      throw Object.assign(
        new Error("Sophos auth rejected — invalid client credentials"),
        {
          failParent: true,
        },
      );
    }
    if (!res.ok) throw new Error(`Sophos token endpoint error: ${res.status}`);

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const expiresIn = data.expires_in ?? 3600;
    return {
      token: data.access_token,
      expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
  }

  async authHeaders(
    tenantId?: string,
    options?: SophosRequestOptions,
  ): Promise<Record<string, string>> {
    const token = await this.getToken();
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (tenantId) headers["X-Tenant-ID"] = tenantId;
    if (options?.partnerId) headers["X-Partner-ID"] = options.partnerId;
    return headers;
  }

  async get<T>(
    url: string,
    tenantId?: string,
    options?: SophosRequestOptions,
  ): Promise<T> {
    const headers = await this.authHeaders(tenantId, options);
    const res = await this.fetchRateLimitAware(url, { headers });
    if (res.status === 401) {
      throw Object.assign(new Error("Sophos auth rejected"), {
        failParent: true,
      });
    }
    if (!res.ok) throw new Error(`Sophos API error ${res.status}: ${url}`);
    return res.json() as Promise<T>;
  }

  async post<T>(
    url: string,
    body: unknown,
    tenantId?: string,
    options?: SophosRequestOptions,
  ): Promise<T> {
    const headers = await this.authHeaders(tenantId, options);
    const res = await this.fetchRateLimitAware(url, {
      method: "POST",
      headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`Sophos POST error ${res.status}: ${url}`);
    return res.json() as Promise<T>;
  }

  async delete<T>(
    url: string,
    tenantId?: string,
    options?: SophosRequestOptions,
  ): Promise<T> {
    const headers = await this.authHeaders(tenantId, options);
    const res = await this.fetchRateLimitAware(url, {
      method: "DELETE",
      headers: { ...headers, Accept: "application/json" },
    });
    if (res.status === 204) return undefined as T;

    const text = await res.text();
    if (!res.ok) {
      throw new Error(
        `Sophos DELETE error ${res.status}: ${url}${text ? ` - ${text}` : ""}`,
      );
    }

    return (text ? JSON.parse(text) : undefined) as T;
  }

  // Page-number pagination used by partner tenants, endpoints, and firewalls
  async fetchAllPages<T>(
    baseUrl: string,
    tenantId?: string,
    options?: SophosRequestOptions,
  ): Promise<T[]> {
    const items: T[] = [];
    let page = 1;

    while (true) {
      const data = await this.get<SophosPagedResponse<T>>(
        `${baseUrl}&page=${page}`,
        tenantId,
        options,
      );
      items.push(...data.items);
      if (page >= data.pages.total) break;
      page++;
    }

    return items;
  }

  private async fetchRateLimitAware(
    input: FetchInput,
    init?: RequestInit,
  ): Promise<Response> {
    return fetchWithRetry(async () => {
      const res = await fetch(input, init);
      if (res.status === 429) {
        throw Object.assign(
          new Error(`Sophos API rate limited: ${inputLabel(input)}`),
          {
            rateLimited: true,
            status: 429,
          },
        );
      }
      return res;
    });
  }
}
