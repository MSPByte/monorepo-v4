import { db, dbCatalog } from '$lib/db';
import type { PermissionGrant } from '@mspbyte/shared';

declare global {
  namespace App {
    // interface Error {}
    interface Locals {
      auth: {
        userId: string;
        orgId: string;
        email: string;
      };
      user: db.User;
      role: db.Role;
      grants: PermissionGrant[];
      org: dbCatalog.AuthOrganization;
      connectionString: string;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
