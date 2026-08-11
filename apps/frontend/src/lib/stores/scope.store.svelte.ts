import { PersistedState } from 'runed';
import type { ProviderId } from '@mspbyte/shared';
import { INTEGRATIONS } from '@mspbyte/shared';

type Integration = {
  id: string;
  config?: unknown;
  createdAt: Date | string;
  updatedAt: Date | string;
  credentialExpiration: Date | string | null;
  deletedAt: Date | string | null;
};

function createScopeStore() {
  const currentGroupId = new PersistedState<string | null>('current_group_id', null, {
    storage: 'session',
    syncTabs: false,
  });
  const currentSiteId = new PersistedState<string | null>('current_site_id', null, {
    storage: 'session',
    syncTabs: false,
  });
  const currentLinkId = new PersistedState<string | null>('current_link_id', null, {
    storage: 'session',
    syncTabs: false,
  });
  const currentIntegration = new PersistedState<ProviderId | null>('current_integration', null, {
    storage: 'session',
    syncTabs: false,
  });
  const activeIntegrations = new PersistedState<Integration[]>('active_integrations', [], {
    storage: 'session',
    syncTabs: true,
  });

  return {
    get currentScope() {
      return currentIntegration.current ? INTEGRATIONS[currentIntegration.current].scope : null;
    },
    get currentLink() {
      return currentLinkId.current || null;
    },
    get currentGroup() {
      return currentGroupId.current || null;
    },
    get currentSite() {
      return currentSiteId.current || null;
    },
    get currentIntegration() {
      return currentIntegration.current || null;
    },
    get activeIntegrations() {
      return activeIntegrations.current;
    },
    clearScope() {
      currentGroupId.current = '';
      currentSiteId.current = '';
      currentLinkId.current = '';
    },
    set currentSite(v: string | null) {
      currentSiteId.current = v ?? '';
      if (v) {
        currentGroupId.current = null;
        currentLinkId.current = null;
      }
    },
    set currentLink(v: string | null) {
      currentLinkId.current = v ?? '';
      if (v) {
        currentGroupId.current = null;
        currentSiteId.current = null;
      }
    },
    set currentGroup(v: string | null) {
      currentGroupId.current = v ?? '';
      if (v) {
        currentSiteId.current = null;
        currentLinkId.current = null;
      }
    },
    set currentIntegration(v: ProviderId | null) {
      currentIntegration.current = v;
      currentGroupId.current = null;
      currentSiteId.current = null;
      currentLinkId.current = null;
    },
    set activeIntegrations(v: Integration[]) {
      activeIntegrations.current = v;
    },
  };
}

export const scopeStore = createScopeStore();
