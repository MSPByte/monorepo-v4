import type { AnyCapability } from './types.js';
import { m365IdentityResetPassword } from './m365/reset-password.js';
import { m365IdentityCreate } from './m365/create-identity.js';
import { m365LicenseAssign } from './m365/assign-license.js';
import { m365IdentityDisable } from './m365/disable-identity.js';
import { m365IdentityRevokeSessions } from './m365/revoke-sessions.js';
import { m365GroupAddMember } from './m365/add-group-member.js';

export const CAPABILITIES = {
  [m365IdentityResetPassword.id]: m365IdentityResetPassword,
  [m365IdentityCreate.id]: m365IdentityCreate,
  [m365LicenseAssign.id]: m365LicenseAssign,
  [m365IdentityDisable.id]: m365IdentityDisable,
  [m365IdentityRevokeSessions.id]: m365IdentityRevokeSessions,
  [m365GroupAddMember.id]: m365GroupAddMember,
} as const satisfies Record<string, AnyCapability>;

export type CapabilityId = keyof typeof CAPABILITIES;

export function getCapability(id: string): AnyCapability | undefined {
  return (CAPABILITIES as Record<string, AnyCapability>)[id];
}

export function listCapabilities(): AnyCapability[] {
  return Object.values(CAPABILITIES);
}
