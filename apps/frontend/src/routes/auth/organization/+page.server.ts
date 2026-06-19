import { redirect } from '@sveltejs/kit';
import { auth } from '$lib/server/auth';
import { getCatalogDb } from '@mspbyte/drizzle-catalog';
import type { PageServerLoad } from './$types';
import { CATALOG_DATABASE_URL } from '$env/static/private';
import { dbCatalog } from '$lib/db';
import { inArray } from 'drizzle-orm';

export const load: PageServerLoad = async ({ request }) => {
  const organizations = await auth.api
    .listOrganizations({ headers: request.headers })
    .catch(() => []);

  if (organizations.length === 1) {
    await auth.api
      .setActiveOrganization({
        headers: request.headers,
        body: { organizationId: organizations[0]!.id },
      })
      .catch(() => null);
    return redirect(303, '/home');
  }

  return {
    organizations,
  };
};
