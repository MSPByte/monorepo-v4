import { goto } from '$app/navigation';
import { PersistedState } from 'runed';
import type { db } from '$lib/db';
import {
  type Permission,
  type PermissionGrant,
  hasPermission,
  hasAnyPermissionUnder,
} from '@mspbyte/shared';

type User = typeof db.users.$inferSelect;
type Role = typeof db.roles.$inferSelect;

function createAuthStore() {
  const user = new PersistedState<User | null>('current_user', null, {
    storage: 'session',
    syncTabs: false,
  });
  const role = new PersistedState<Role | null>('current_role', null, {
    storage: 'session',
    syncTabs: false,
  });
  const grants = new PersistedState<PermissionGrant[]>('current_grants', [], {
    storage: 'session',
    syncTabs: false,
  });
  const org = new PersistedState<string | null>('current_org', null, {
    storage: 'session',
    syncTabs: false,
  });
  const orgDev = new PersistedState<boolean | null>('current_org_dev', null, {
    storage: 'session',
    syncTabs: false,
  });

  return {
    get currentUser() {
      return user.current;
    },
    get currentRole() {
      return role.current;
    },
    get currentGrants() {
      return grants.current;
    },
    get currentOrg() {
      return org.current;
    },
    set currentUser(u: User | null) {
      user.current = u;
    },
    set currentRole(r: Role | null) {
      role.current = r;
    },
    set currentGrants(g: PermissionGrant[]) {
      grants.current = g;
    },
    set currentOrg(o: string | null) {
      org.current = o;
    },
    set currentOrgDev(d: boolean | null) {
      orgDev.current = d;
    },

    isDev: () => {
      return orgDev.current;
    },

    isAllowed: (p: Permission) => hasPermission(grants.current ?? [], p),

    canUnder: (prefix: string) => hasAnyPermissionUnder(grants.current ?? [], prefix),

    logout: (signOutFn?: () => void) => {
      user.current = null;
      role.current = null;
      grants.current = [];
      if (signOutFn) {
        signOutFn();
      } else {
        void goto('/auth/signout');
      }
    },
  };
}

export const authStore = createAuthStore();
