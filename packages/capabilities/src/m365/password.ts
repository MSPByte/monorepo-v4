import { randomBytes } from 'node:crypto';

// Azure AD default policy: 8-256 chars, at least 3 of 4 categories
// (upper/lower/digit/symbol). We generate 16 chars and guarantee all four.
// Kept in sync with the same helper in packages/trpc/src/routers/vendor.ts.
export function generateM365Password(): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*';
  const all = lower + upper + digits + symbols;
  const pick = (charset: string) => charset[randomBytes(1)[0]! % charset.length]!;

  const required = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  const restLen = 16 - required.length;
  const buf = randomBytes(restLen);
  const chars = [...required];
  for (let i = 0; i < restLen; i++) chars.push(all[buf[i]! % all.length]!);

  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0]! % (i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
