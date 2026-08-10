import { generatePassword } from '../generators/password.js';

// Legacy default used by reset-password and older create-identity call sites:
// 16 chars, symbols on, ambiguous chars excluded so operators can retype
// them cleanly over a phone call.
export function generateM365Password(): string {
  return generatePassword({ length: 16, symbols: true, excludeAmbiguous: true });
}
