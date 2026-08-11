import { eq } from 'drizzle-orm';
import {
  packages as packagesTable,
  integrationLinks,
  siteGroupLinkMembers,
  siteGroupMembers
} from '@mspbyte/drizzle';
import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';

type PackageRow = Pick<
  typeof packagesTable.$inferSelect,
  'allowedSites' | 'allowedSiteGroups' | 'allowedIntegrationLinks'
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
      : []
  };
}

export function isGlobalPackageScope(scope: PackageScope): boolean {
  return scope.sites.length === 0 && scope.groups.length === 0 && scope.links.length === 0;
}

export async function loadMatchingGroupIds(
  db: {
    select: (...args: any[]) => any;
  },
  target: ScopeTarget
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
  matchingGroupIds: ReadonlySet<string>
): boolean {
  if (isGlobalPackageScope(scope)) return true;
  if (target.siteId && scope.sites.includes(target.siteId)) return true;
  if (target.linkId && scope.links.includes(target.linkId)) return true;
  if (scope.groups.length > 0 && (target.siteId || target.linkId)) {
    return scope.groups.some((groupId) => matchingGroupIds.has(groupId));
  }
  return false;
}

export async function assertTenantScopedIntegrationLinks(
  db: {
    select: (...args: any[]) => any;
  },
  linkIds: string[]
): Promise<{ ok: true } | { ok: false; message: string }> {
  if (linkIds.length === 0) return { ok: true };

  const rows = await db
    .select({
      id: integrationLinks.id,
      integrationId: integrationLinks.integrationId,
      name: integrationLinks.name
    })
    .from(integrationLinks);

  const byId = new Map(
    (rows as Array<{ id: string; integrationId: string; name: string | null }>).map((row) => [
      row.id,
      row
    ])
  );
  for (const linkId of linkIds) {
    const row = byId.get(linkId);
    if (!row) {
      return { ok: false, message: `Unknown integration link ${linkId}` };
    }
    const integration = INTEGRATIONS[row.integrationId as ProviderId];
    if (!integration) {
      return { ok: false, message: `Unknown integration ${row.integrationId}` };
    }
    if (integration.scope !== 'tenant') {
      return {
        ok: false,
        message: `${integration.name} links are site-scoped and cannot be assigned directly to packages`
      };
    }
  }

  return { ok: true };
}
