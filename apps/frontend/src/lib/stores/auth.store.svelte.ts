import { goto } from '$app/navigation';
import { PersistedState } from 'runed';
import type { db } from '$lib/db';
import { type Permission, hasPermission } from '@mspbyte/shared';
import { PUBLIC_DEV_ORG } from '$env/static/public';

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
  const org = new PersistedState<string | null>('current_org', null, {
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
    get currentOrg() {
      return org.current;
    },
    set currentUser(u: User | null) {
      user.current = u;
    },
    set currentRole(r: Role | null) {
      role.current = r;
    },
    set currentOrg(o: string | null) {
      org.current = o;
    },

    isDev: () => {
      return org.current === PUBLIC_DEV_ORG;
    },

    isAllowed: (p: Permission) => {
      const attrs = (role.current?.attributes as Record<string, boolean> | null) ?? null;
      return hasPermission(attrs, p);
    },

    logout: (signOutFn?: () => void) => {
      user.current = null;
      role.current = null;
      if (signOutFn) {
        signOutFn();
      } else {
        void goto('/auth/signout');
      }
    },
  };
}

export const authStore = createAuthStore();
