import { eq, inArray } from 'drizzle-orm';
import { siteGroupLinkMembers, siteGroupMembers } from '@mspbyte/drizzle';

type Db = {
  select: (...args: any[]) => any;
};

export async function loadGroupTargets(
  db: Db,
  groupId: string
): Promise<{ siteIds: string[]; linkIds: string[] }> {
  const [siteRows, linkRows] = (await Promise.all([
    db
      .select({ siteId: siteGroupMembers.siteId })
      .from(siteGroupMembers)
      .where(eq(siteGroupMembers.siteGroupId, groupId)),
    db
      .select({ linkId: siteGroupLinkMembers.integrationLinkId })
      .from(siteGroupLinkMembers)
      .where(eq(siteGroupLinkMembers.siteGroupId, groupId))
  ])) as [{ siteId: string }[], { linkId: string }[]];

  return {
    siteIds: [...new Set<string>(siteRows.map((row) => row.siteId))],
    linkIds: [...new Set<string>(linkRows.map((row) => row.linkId))]
  };
}

export async function loadLinkIdsForGroups(db: Db, groupIds: string[]): Promise<string[]> {
  if (groupIds.length === 0) return [];
  const rows = (await db
    .select({ linkId: siteGroupLinkMembers.integrationLinkId })
    .from(siteGroupLinkMembers)
    .where(inArray(siteGroupLinkMembers.siteGroupId, groupIds))) as { linkId: string }[];
  return [...new Set<string>(rows.map((row) => row.linkId))];
}
