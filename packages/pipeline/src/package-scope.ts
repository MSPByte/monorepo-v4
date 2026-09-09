import { eq } from "drizzle-orm";
import {
  packages as packagesTable,
  siteGroupLinkMembers,
  siteGroupMembers,
} from "@mspbyte/drizzle";

// Scope evaluation for where a package is allowed to run. Shared between the
// tRPC launch mutations and backend services (e.g. agent form triggers) so
// every dispatch surface enforces the same authored allow-lists.

type PackageRow = Pick<
  typeof packagesTable.$inferSelect,
  "allowedSites" | "allowedSiteGroups" | "allowedIntegrationLinks"
>;

type ScopeTarget = {
  siteId?: string | null;
  linkId?: string | null;
};

export type PackageScope = {
  sites: string[];
  groups: string[];
  links: string[];
};

export function readPackageScope(row: PackageRow): PackageScope {
  return {
    sites: Array.isArray(row.allowedSites) ? (row.allowedSites as string[]) : [],
    groups: Array.isArray(row.allowedSiteGroups) ? (row.allowedSiteGroups as string[]) : [],
    links: Array.isArray(row.allowedIntegrationLinks)
      ? (row.allowedIntegrationLinks as string[])
      : [],
  };
}

export function isGlobalPackageScope(scope: PackageScope): boolean {
  return scope.sites.length === 0 && scope.groups.length === 0 && scope.links.length === 0;
}

export async function loadMatchingGroupIds(
  db: {
    select: (...args: any[]) => any;
  },
  target: ScopeTarget,
): Promise<Set<string>> {
  const ids = new Set<string>();

  if (target.siteId) {
    const rows = await db
      .select({ groupId: siteGroupMembers.siteGroupId })
      .from(siteGroupMembers)
      .where(eq(siteGroupMembers.siteId, target.siteId));
    for (const row of rows) ids.add(row.groupId);
  }

  if (target.linkId) {
    const rows = await db
      .select({ groupId: siteGroupLinkMembers.siteGroupId })
      .from(siteGroupLinkMembers)
      .where(eq(siteGroupLinkMembers.integrationLinkId, target.linkId));
    for (const row of rows) ids.add(row.groupId);
  }

  return ids;
}

export function packageMatchesScope(
  scope: PackageScope,
  target: ScopeTarget,
  matchingGroupIds: ReadonlySet<string>,
): boolean {
  if (isGlobalPackageScope(scope)) return true;
  if (target.siteId && scope.sites.includes(target.siteId)) return true;
  if (target.linkId && scope.links.includes(target.linkId)) return true;
  if (scope.groups.length > 0 && (target.siteId || target.linkId)) {
    return scope.groups.some((groupId) => matchingGroupIds.has(groupId));
  }
  return false;
}
