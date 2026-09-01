export type WriteBackEffect = 'patch' | 'insert' | 'delete' | 'none';
export type WriteBackSource = 'inputs' | 'response';

export interface WriteBackKey {
  field: string;
  column: string;
  source: WriteBackSource;
}

export type WriteBackMapping = WriteBackKey;

export interface WriteBackConfig {
  effect: WriteBackEffect;
  table?: string;
  key?: WriteBackKey;
  mappings?: WriteBackMapping[];
}

/** WRITE_BACK_ALLOWED_TABLES and its types live in @mspbyte/shared so the
 *  frontend can import them directly without a tRPC round-trip. Re-exported
 *  here so server-side callers (catalog-executor, tRPC router) don't need to
 *  change their import path. */
export {
  WRITE_BACK_ALLOWED_TABLES,
  type WriteBackTableInfo,
  type WriteBackTableColumn,
} from '@mspbyte/shared';
