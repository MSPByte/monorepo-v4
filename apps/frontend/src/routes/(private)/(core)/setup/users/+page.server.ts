import { fail } from '@sveltejs/kit';
import type { Actions } from './$types';
import { z } from 'zod';
import { createServerCaller } from '$lib/server/trpc';

const AddUserSchema = z.object({
  name: z.string().min(1, 'Name is required'),
  email: z.email('Invalid email address'),
  roleId: z.uuid('Role is required'),
});

export const actions: Actions = {
  addUser: async ({ request, locals }) => {
    const raw = await request.formData();
    const parsed = AddUserSchema.safeParse(Object.fromEntries(raw.entries()));
    if (!parsed.success) {
      return fail(400, { error: parsed.error.issues[0]?.message ?? 'Invalid form data' });
    }

    const caller = createServerCaller({
      auth: locals.auth,
      org: locals.org,
      user: locals.user,
      role: locals.role,
      connectionString: locals.connectionString,
    });

    try {
      await caller.users.create(parsed.data);
      return { success: true };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return fail(400, { error: message });
    }
  },
};
