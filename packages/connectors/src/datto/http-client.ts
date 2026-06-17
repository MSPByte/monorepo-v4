import { fetchWithTimeout } from "../fetch.js";

// Hardcoded per Datto RMM OAuth spec — the client always uses public-client:public
const BASIC_AUTH = "Basic " + btoa("public-client:public");

interface TokenEntry {
  token: string;
  expiresAt: number;
}

// Process-level token cache keyed by `${url}::${apiKey}::datto`
const tokenCache = new Map<string, Promise<TokenEntry>>();

function tokenCacheKey(url: string, apiKey: string): string {
  return `${url}::${apiKey}::datto`;
}

export class DattoHttpClient {
  constructor(
    readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly apiSecretKey: string,
  ) {}

  async getToken(): Promise<string> {
    const key = tokenCacheKey(this.baseUrl, this.apiKey);
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
    const res = await fetchWithTimeout(`${this.baseUrl}/auth/oauth/token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: BASIC_AUTH,
      },
      body: new URLSearchParams({
        grant_type: "password",
        username: this.apiKey,
        password: this.apiSecretKey,
      }),
    });

    if (res.status === 401) {
      throw Object.assign(new Error("DattoRMM: invalid API credentials"), {
        failParent: true,
      });
    }
    if (!res.ok) throw new Error(`DattoRMM token error: ${res.status}`);

    const data = (await res.json()) as {
      access_token: string;
      expires_in?: number;
    };
    const expiresIn = data.expires_in ?? 55 * 60;
    return {
      token: data.access_token,
      expiresAt: Date.now() + (expiresIn - 30) * 1000,
    };
  }

  async get<T>(url: string): Promise<T> {
    const token = await this.getToken();
    const fullUrl = url.startsWith("http") ? url : `${this.baseUrl}${url}`;
    const res = await fetchWithTimeout(fullUrl, {
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
    if (res.status === 401) {
      throw Object.assign(new Error("DattoRMM auth rejected"), {
        failParent: true,
      });
    }
    if (!res.ok)
      throw new Error(`DattoRMM API error ${res.status}: ${fullUrl}`);
    return res.json() as Promise<T>;
  }

  async getOrNull<T>(url: string): Promise<T | null> {
    try {
      return await this.get<T>(url);
    } catch {
      return null;
    }
  }

  async post<T>(url: string, body: unknown): Promise<T> {
    const token = await this.getToken();
    const fullUrl = url.startsWith("http") ? url : `${this.baseUrl}${url}`;
    const res = await fetchWithTimeout(fullUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(`DattoRMM POST error ${res.status}: ${fullUrl}`);
    return res.json() as Promise<T>;
  }

  async put<T>(url: string, body: unknown): Promise<T> {
    const token = await this.getToken();
    const fullUrl = url.startsWith("http") ? url : `${this.baseUrl}${url}`;
    const res = await fetchWithTimeout(fullUrl, {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok)
      throw new Error(`DattoRMM PUT error ${res.status}: ${fullUrl}`);
    return res.json() as Promise<T>;
  }
}
