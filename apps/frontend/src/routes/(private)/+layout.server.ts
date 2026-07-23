import { redirect } from '@sveltejs/kit';
import type { LayoutServerLoad } from './$types';
import { buildFilteredRouteMap } from '$lib/config/routes';

export const load: LayoutServerLoad = async ({ locals }) => {
  if (!locals.user || !locals.role) {
    return redirect(303, '/auth/login');
  }

  const routeMap = buildFilteredRouteMap(locals.grants, { isDev: locals.org.isDev });

  return {
    user: locals.user,
    role: locals.role,
    grants: locals.grants,
    orgId: locals.org.id,
    orgName: locals.org.name,
    orgDev: locals.org.isDev,
    // Serialize the Map as an array of [group, routes] entries — Map itself
    // isn't structured-clone-safe across the SvelteKit server→client boundary.
    routeGroups: [...routeMap.entries()],
  };
};
