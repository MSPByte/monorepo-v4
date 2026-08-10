import { randomBytes } from 'node:crypto';
import { z } from 'zod';

// Ambiguous glyphs excluded when `excludeAmbiguous` is on. Keeps generated
// passwords readable when they'll be dictated / retyped.
const LOWER_FULL = 'abcdefghijklmnopqrstuvwxyz';
const UPPER_FULL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS_FULL = '0123456789';
const SYMBOLS_FULL = '!@#$%^&*()-_=+[]{}';

const LOWER_SAFE = 'abcdefghijkmnopqrstuvwxyz';
const UPPER_SAFE = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const DIGITS_SAFE = '23456789';
const SYMBOLS_SAFE = '!@#$%^&*';

export const passwordParamsSchema = z.object({
  length: z.number().int().min(8).max(128),
  symbols: z.boolean(),
  excludeAmbiguous: z.boolean(),
});

export type PasswordParams = z.infer<typeof passwordParamsSchema>;

export function generatePassword(params: PasswordParams): string {
  const lower = params.excludeAmbiguous ? LOWER_SAFE : LOWER_FULL;
  const upper = params.excludeAmbiguous ? UPPER_SAFE : UPPER_FULL;
  const digits = params.excludeAmbiguous ? DIGITS_SAFE : DIGITS_FULL;
  const symbols = params.excludeAmbiguous ? SYMBOLS_SAFE : SYMBOLS_FULL;

  const required = [pick(lower), pick(upper), pick(digits)];
  if (params.symbols) required.push(pick(symbols));

  const all = lower + upper + digits + (params.symbols ? symbols : '');
  const restLen = params.length - required.length;
  const buf = randomBytes(restLen);
  const chars = [...required];
  for (let i = 0; i < restLen; i++) chars.push(all[buf[i]! % all.length]!);

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}

function pick(charset: string): string {
  return charset[randomBytes(1)[0]! % charset.length]!;
}
