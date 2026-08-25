import { RETRYABLE_ERROR_CLASSES, type ErrorClass } from '../types.js';

export type FailResult = {
  outcome: 'fail';
  errorClass: ErrorClass;
  message: string;
  retryable: boolean;
};

/**
 * Maps a Graph client error to the platform error taxonomy.
 *
 * The Graph client formats errors as "Graph API {METHOD} error {STATUS}: {path} – {body}".
 * Auth failures carry `failParent: true` and are non-retryable credential errors.
 * 5xx statuses are classified as `transient` (retryable); 4xx are mapped to specific classes.
 */
export function classifyGraphError(error: unknown): FailResult {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && (error as Error & { failParent?: boolean }).failParent === true) {
    return { outcome: 'fail', errorClass: 'permission_denied', message, retryable: false };
  }
  const statusMatch = message.match(/\berror (\d{3})\b/i);
  const status = statusMatch ? Number(statusMatch[1]) : 0;
  const errorClass: ErrorClass =
    status === 400 ? 'invalid_input'
    : status === 403 ? 'permission_denied'
    : status === 404 ? 'not_found'
    : status === 409 ? 'already_exists'
    : status === 429 ? 'rate_limited'
    : status >= 500 ? 'transient'
    : 'vendor_error';
  return { outcome: 'fail', errorClass, message, retryable: RETRYABLE_ERROR_CLASSES.includes(errorClass) };
}
