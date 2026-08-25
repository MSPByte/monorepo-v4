import { and, eq, isNull } from 'drizzle-orm';
import { integrationLinks, integrations } from '@mspbyte/drizzle';
import type { createTenantDb } from '@mspbyte/drizzle-catalog';
import {
  getCapability,
  isCapabilityAvailable,
  type CapabilityAvailabilityInventory,
} from '@mspbyte/capabilities';

type TenantDb = ReturnType<typeof createTenantDb>;
type CapabilityStepLike = { kind?: string; capabilityId?: string };

// This is deliberately tenant-scoped by the request database connection. It
// supplies the one availability decision shared by catalog browsing, package
// writes, and dispatch; the UI is never the authority for access to a vendor.
export async function loadCapabilityAvailabilityInventory(
  db: TenantDb,
): Promise<CapabilityAvailabilityInventory> {
  const [configured, activeLinks] = await Promise.all([
    db
      .select({ id: integrations.id })
      .from(integrations)
      .where(isNull(integrations.deletedAt)),
    db
      .select({ integrationId: integrationLinks.integrationId })
      .from(integrationLinks)
      .innerJoin(
        integrations,
        and(
          eq(integrationLinks.integrationId, integrations.id),
          isNull(integrations.deletedAt),
        ),
      )
      .where(eq(integrationLinks.status, 'active')),
  ]);

  return {
    configuredIntegrationIds: new Set(configured.map((row: { id: string }) => row.id)),
    activeLinkIntegrationIds: new Set(
      activeLinks.map((row: { integrationId: string }) => row.integrationId),
    ),
  };
}

export function findUnavailableCapabilities(
  steps: readonly CapabilityStepLike[],
  inventory: CapabilityAvailabilityInventory,
) {
  return steps.flatMap((step) => {
    if (step.kind === 'subpackage' || !step.capabilityId) return [];
    const capability = getCapability(step.capabilityId);
    if (!capability || isCapabilityAvailable(capability, inventory)) return [];
    return [capability];
  });
}

export function unavailableCapabilitiesMessage(
  capabilities: ReturnType<typeof findUnavailableCapabilities>,
): string {
  const names = [...new Set(capabilities.map((capability) => capability.name))];
  return `${names.join(', ')} ${names.length === 1 ? 'requires' : 'require'} an integration that is not set up or has no active link.`;
}
