import { createLogger } from '@mspbyte/logging';
import { env } from './env.js';

export const logger = createLogger('mspbyte:agents', env.LOG_LEVEL);
