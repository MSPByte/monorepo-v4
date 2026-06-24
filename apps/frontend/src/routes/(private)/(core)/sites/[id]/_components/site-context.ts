import { getContext, setContext } from 'svelte';
import type { ClientProfile } from '../_profile/client-profile.types';

export type SiteRecord = {
  id: string;
  name: string;
  description: string | null;
  parentSiteId: string | null;
  attributes: Record<string, unknown>;
  assetCount: number;
  peopleCount: number;
  openFindingCount: number;
  sources: string[];
  frameworkScore: number;
  policyHealth: number;
  createdAt: string;
  updatedAt: string;
};

export type SiteContextStore = {
  site: SiteRecord | null;
  profile: ClientProfile | null;
};

const KEY = Symbol('site-context');

export function provideSiteContext(store: SiteContextStore) {
  setContext(KEY, store);
}

export function useSiteContext(): SiteContextStore {
  const ctx = getContext<SiteContextStore | undefined>(KEY);
  if (!ctx) throw new Error('useSiteContext must be used within sites/[id] layout');
  return ctx;
}
