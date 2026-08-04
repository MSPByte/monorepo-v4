import { toast } from 'svelte-sonner';
import { dev } from '$app/environment';

/**
 * Turn any thrown value into a short, end-user-safe message.
 *
 * Rules:
 * - Raw provider/network details (URLs, request ids, JSON blobs, stack traces)
 *   never make it to the returned string.
 * - Well-known signatures are mapped to friendly copy.
 * - Everything else falls back to the caller-provided `fallback`, or a generic
 *   "Something went wrong" if none is given.
 */
export function toUserMessage(err: unknown, fallback?: string): string {
  const raw = extractRawMessage(err);

  for (const rule of RULES) {
    if (rule.match.test(raw)) return rule.message;
  }

  return fallback ?? 'Something went wrong. Please try again.';
}

/**
 * Standard error-toast helper. Always logs the raw error to the console for
 * developers, and only surfaces the sanitized message to the user.
 *
 * Usage:
 *   try { ... }
 *   catch (err) { showErrorToast(err, 'Assign licenses failed'); }
 */
export function showErrorToast(
  err: unknown,
  fallback?: string,
  opts?: { logLabel?: string }
): void {
  logError(err, opts?.logLabel);
  toast.error(toUserMessage(err, fallback));
}

/**
 * Warning-level variant. Same sanitization rules — use for partial failures
 * where some work succeeded (e.g. batch mutations).
 */
export function showWarningToast(
  message: string,
  err?: unknown,
  opts?: { logLabel?: string }
): void {
  if (err !== undefined) logError(err, opts?.logLabel);
  toast.warning(message);
}

/**
 * Log the raw error to the console with an optional label. In prod builds the
 * label + message are still emitted; verbose objects only in dev to keep
 * production consoles tidy.
 */
export function logError(err: unknown, label?: string): void {
  const prefix = label ? `[${label}]` : '[error]';
  if (dev) {
    console.error(prefix, err);
  } else {
    // Production: emit a compact form so it's still greppable in remote logs
    // without leaking stack traces to users who open devtools.
    console.error(prefix, extractRawMessage(err));
  }
}

function extractRawMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object') {
    const msg = (err as { message?: unknown }).message;
    if (typeof msg === 'string') return msg;
  }
  return String(err);
}

// Ordered — first matching rule wins. Add here, not in call sites.
const RULES: Array<{ match: RegExp; message: string }> = [
  // Microsoft Graph — throttling / transient
  {
    match: /Directory_ConcurrencyViolation|concurrent requests being made/i,
    message: 'The service is busy right now. Please wait a moment and try again.'
  },
  {
    match: /Graph API .* error 429|Too Many Requests|throttl/i,
    message: 'Microsoft 365 rate-limited the request. Please retry in a moment.'
  },
  {
    match: /Graph API .* error 50\d/i,
    message: 'Microsoft 365 is temporarily unavailable. Please try again shortly.'
  },
  // Microsoft Graph — auth / permission
  {
    match: /M365 auth rejected|Graph API .* error 401|invalid_client|AADSTS/i,
    message: 'Microsoft 365 authentication failed. Check the integration credentials.'
  },
  {
    match: /Graph API .* error 403|Forbidden|Authorization_RequestDenied|Insufficient privileges/i,
    message: "This account doesn't have permission to perform that action in Microsoft 365."
  },
  {
    match: /Graph API .* error 404/i,
    message: "The item couldn't be found in Microsoft 365 — it may have been removed."
  },
  // Sophos / other vendors — extend as needed
  {
    match: /Sophos .* 401|Sophos auth/i,
    message: 'Sophos authentication failed. Check the integration credentials.'
  },
  {
    match: /Sophos .* 429/i,
    message: 'Sophos rate-limited the request. Please retry in a moment.'
  },
  // tRPC / permissions
  {
    match: /Vendors\.Write permission required|Vendors\.Read permission required|permission required/i,
    message: "You don't have permission to do that."
  },
  {
    match: /UNAUTHORIZED|session expired/i,
    message: 'Your session has expired. Please sign in again.'
  },
  // Network
  {
    match: /Failed to fetch|NetworkError|ECONNREFUSED|ENOTFOUND|ETIMEDOUT/i,
    message: 'Network error — check your connection and try again.'
  }
];
