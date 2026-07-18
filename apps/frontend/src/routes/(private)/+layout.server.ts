import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user || !locals.role) {
    return redirect(303, '/auth/login');
  }

  return {
    user: locals.user,
    role: locals.role,
    orgId: locals.org.id,
    orgName: locals.org.name,
    orgDev: locals.org.isDev,
  };
};
