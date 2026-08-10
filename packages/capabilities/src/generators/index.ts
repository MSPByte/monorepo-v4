import type { z } from 'zod';
import { generatePassword, passwordParamsSchema, type PasswordParams } from './password.js';

export { generatePassword, passwordParamsSchema, type PasswordParams };

// A generator turns a params object into a value at binding-resolve time.
// Registering here lets the builder UI enumerate generators and the worker
// resolve `{ kind: 'generated' }` bindings without hardcoding names.
export interface GeneratorDef<Params = unknown, Value = unknown> {
  id: string;
  label: string;
  description: string;
  // Only inputs whose typeHint matches one of these are allowed to bind to
  // this generator in the builder UI.
  appliesToTypeHints: readonly string[];
  paramsSchema: z.ZodType<Params>;
  defaults: Params;
  generate: (params: Params) => Value;
}

const passwordGenerator: GeneratorDef<PasswordParams, string> = {
  id: 'password',
  label: 'Generate password',
  description:
    'Produce a random password at run time. Length and character classes are configurable.',
  appliesToTypeHints: ['password'],
  paramsSchema: passwordParamsSchema,
  defaults: { length: 20, symbols: true, excludeAmbiguous: false },
  generate: (p) => generatePassword(p),
};

const GENERATORS = new Map<string, GeneratorDef<any, any>>([
  [passwordGenerator.id, passwordGenerator],
]);

export function getGenerator(id: string): GeneratorDef | undefined {
  return GENERATORS.get(id);
}

export function listGenerators(): GeneratorDef[] {
  return Array.from(GENERATORS.values());
}
