import { fetchWithTimeout } from "../fetch.js";

export interface CoveRpcError {
  code: number;
  message: string;
}

interface CoveRpcResponse<T> {
  visa?: string;
  result?: T;
  error?: CoveRpcError;
}

// Process-level visa cache keyed by `${server}::${clientId}::cove`.
// Stores in-flight Promises so concurrent callers share one Login call.
const visaCache = new Map<string, Promise<string>>();

function visaCacheKey(server: string, clientId: string): string {
  return `${server}::${clientId}::cove`;
}

export class CoveHttpClient {
  constructor(
    readonly server: string,
    private readonly clientId: string,
    private readonly clientSecret: string,
  ) {}

  async getVisa(): Promise<string> {
    const key = visaCacheKey(this.server, this.clientId);
    const cached = visaCache.get(key);
    if (cached) return cached;

    const pending = this.fetchVisa();
    visaCache.set(key, pending);
    pending.catch(() => visaCache.delete(key));
    return pending;
  }

  private async fetchVisa(): Promise<string> {
    const res = await fetchWithTimeout(this.server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "login",
        method: "Login",
        params: { username: this.clientId, password: this.clientSecret },
      }),
    });

    if (!res.ok) {
      throw Object.assign(new Error(`Cove login HTTP error: ${res.status}`), {
        failParent: true,
      });
    }

    const data = (await res.json()) as { visa?: string; error?: CoveRpcError };
    if (data.error) {
      throw Object.assign(
        new Error(
          `Cove login error: ${data.error.message} (code ${data.error.code})`,
        ),
        { failParent: true },
      );
    }
    if (!data.visa) throw new Error("Cove: no visa in login response");
    return data.visa;
  }

  async rpc<T>(method: string, params: unknown): Promise<T> {
    const visa = await this.getVisa();
    const res = await fetchWithTimeout(this.server, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "jsonrpc",
        visa,
        method,
        params,
      }),
    });

    if (!res.ok) throw new Error(`Cove RPC HTTP error: ${res.status}`);

    const body = (await res.json()) as CoveRpcResponse<T>;

    if (body.error) {
      // Expired visa or rate-limited login — evict cache so next call re-authenticates
      if (body.error.code === -32001 || body.error.code === -32603) {
        visaCache.delete(visaCacheKey(this.server, this.clientId));
        throw Object.assign(
          new Error(`Cove auth error: ${body.error.message}`),
          { failParent: true },
        );
      }
      throw new Error(
        `Cove RPC error: ${body.error.message} (code ${body.error.code})`,
      );
    }

    return body.result as T;
  }
}
