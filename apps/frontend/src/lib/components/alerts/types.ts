import type { db } from '$lib/db';

type SerializedDate = Date | string;

export type UiAlert = Omit<
  db.Alert,
  | 'updatedAt'
  | 'firstSeen'
  | 'lastSeenAt'
  | 'resolvedAt'
  | 'suppressedAt'
  | 'suppressedUntil'
  | 'metadata'
> & {
  updatedAt: SerializedDate;
  firstSeen: SerializedDate;
  lastSeenAt: SerializedDate;
  resolvedAt: SerializedDate | null;
  suppressedAt: SerializedDate | null;
  suppressedUntil: SerializedDate | null;
  metadata?: unknown;
};
