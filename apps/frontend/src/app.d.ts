import { db, dbCatalog } from '$lib/db';

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
      org: dbCatalog.AuthOrganization;
      connectionString: string;
    }
    // interface PageData {}
    // interface PageState {}
    // interface Platform {}
  }
}

export {};
