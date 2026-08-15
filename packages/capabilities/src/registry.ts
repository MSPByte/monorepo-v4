import type { AnyCapability } from './types.js';
import { m365IdentityResetPassword } from './m365/reset-password.js';
import { m365IdentityCreate } from './m365/create-identity.js';
import { m365LicenseAssign } from './m365/assign-license.js';
import { m365IdentityDisable } from './m365/disable-identity.js';
import { m365IdentityRevokeSessions } from './m365/revoke-sessions.js';
import { m365GroupAddMember } from './m365/add-group-member.js';
import { m365GroupCreate } from './m365/create-group.js';
import { m365ConditionalAccessPolicyCreate } from './m365/create-conditional-access-policy.js';
import { coreSiteProvision } from './core/provision-site.js';
import { coreHaloPSATicketCreate } from './core/halopsa-create-ticket.js';
import {
  legacySophosEndpointDisableTamper,
  legacySophosEndpointEnableTamper,
  legacySophosEndpointsEnableTamper,
  sophosEndpointToggleTamper,
} from './sophos/enable-tamper.js';
import { sophosEndpointDelete } from './sophos/delete-endpoint.js';
import { sophosCreateSite } from './sophos/create-site.js';
import { dattoCreateSite } from './datto/create-site.js';
import { coveCreateSite } from './cove/create-site.js';

export const CAPABILITIES = {
  [coreSiteProvision.id]: coreSiteProvision,
  [coreHaloPSATicketCreate.id]: coreHaloPSATicketCreate,
  [m365IdentityResetPassword.id]: m365IdentityResetPassword,
  [m365IdentityCreate.id]: m365IdentityCreate,
  [m365LicenseAssign.id]: m365LicenseAssign,
  [m365IdentityDisable.id]: m365IdentityDisable,
  [m365IdentityRevokeSessions.id]: m365IdentityRevokeSessions,
  [m365GroupAddMember.id]: m365GroupAddMember,
  [m365GroupCreate.id]: m365GroupCreate,
  [m365ConditionalAccessPolicyCreate.id]: m365ConditionalAccessPolicyCreate,
  [sophosEndpointToggleTamper.id]: sophosEndpointToggleTamper,
  [legacySophosEndpointEnableTamper.id]: legacySophosEndpointEnableTamper,
  [legacySophosEndpointDisableTamper.id]: legacySophosEndpointDisableTamper,
  [legacySophosEndpointsEnableTamper.id]: legacySophosEndpointsEnableTamper,
  [sophosEndpointDelete.id]: sophosEndpointDelete,
  [sophosCreateSite.id]: sophosCreateSite,
  [dattoCreateSite.id]: dattoCreateSite,
  [coveCreateSite.id]: coveCreateSite,
} as const satisfies Record<string, AnyCapability>;

export type CapabilityId = keyof typeof CAPABILITIES;

export function getCapability(id: string): AnyCapability | undefined {
  return (CAPABILITIES as Record<string, AnyCapability>)[id];
}

export function listCapabilities(): AnyCapability[] {
  return Object.values(CAPABILITIES);
}
