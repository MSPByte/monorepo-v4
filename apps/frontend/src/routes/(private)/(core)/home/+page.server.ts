import { redirect } from '@sveltejs/kit';
import type { PageServerLoad } from './$types';
import { createServerCaller } from '$lib/server/trpc';

export const load: PageServerLoad = async ({ locals }) => {
  // Only authenticated users reach here; parent layout enforces this.
  if (!locals.user) return {};

  let landingDashboardId: string | null = null;
  try {
    const caller = createServerCaller(locals);
    const prefs = await caller.reports.getMyPrefs();
    landingDashboardId = prefs.landingDashboardId ?? null;
  } catch (err) {
    // A failed prefs lookup shouldn't block the overview page; a missing
    // reports schema (e.g. pre-migration tenants) falls through here.
    console.error('landing pref lookup failed', err);
  }

  if (landingDashboardId) {
    redirect(303, `/dashboards/${landingDashboardId}`);
  }

  return {};
};
