import { toast } from 'svelte-sonner';
import { logError, toUserMessage } from '$lib/utils/errors';

export type PairResult = {
  batchId: string;
  requested: number;
  found: number;
  updated: number;
  skipped: number;
  failed: number;
  result: 'success' | 'failure' | 'partial';
  results: Array<{
    identityId: string;
    identityLabel: string;
    relationId: string;
    relationLabel: string;
    success: boolean;
    skipped?: boolean;
    error?: string;
  }>;
};

export function summarizePairResult(kind: string, r: PairResult) {
  if (r.result === 'success') {
    toast.success(`${kind}: ${r.updated} change${r.updated === 1 ? '' : 's'}`);
    return;
  }

  const failures = r.results.filter((x) => !x.success);
  // Raw per-pair errors are useful for support / audit — log them but never
  // put them in a toast body.
  if (failures.length > 0) logError(failures, `pair-mutation:${kind}`);

  // Fold the failed messages through the sanitizer and de-dupe. If every
  // failure sanitizes to the same friendly reason, name it once — otherwise
  // report a count.
  const reasons = [...new Set(failures.map((f) => toUserMessage(f.error, 'Action failed')))];

  if (r.result === 'partial') {
    if (reasons.length === 1) {
      toast.warning(`${kind}: ${r.updated} succeeded, ${r.failed} failed — ${reasons[0]}`);
    } else {
      toast.warning(`${kind}: ${r.updated} succeeded, ${r.failed} failed for different reasons.`);
    }
    return;
  }

  // Total failure.
  if (reasons.length === 1) {
    toast.error(`${kind} failed — ${reasons[0]}`);
  } else {
    toast.error(`${kind} failed. Please try again.`);
  }
}
