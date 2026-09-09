import { integrationLinks } from '@mspbyte/drizzle';
import { INTEGRATIONS, type ProviderId } from '@mspbyte/shared';

// Scope evaluation moved to @mspbyte/pipeline so backend services (agent form
// triggers) enforce the same allow-lists as the tRPC launch mutations.
export {
  readPackageScope,
  isGlobalPackageScope,
  loadMatchingGroupIds,
  packageMatchesScope,
  type PackageScope,
} from '@mspbyte/pipeline';

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
