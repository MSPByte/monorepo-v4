import { ActionLabels } from '@mspbyte/shared';
import { defineGraphIdentityOperation } from './identity-openapi.js';

export const m365IdentityRevokeSessions = defineGraphIdentityOperation({
  id: 'm365.identity.revoke-sessions',
  name: 'Revoke M365 Sign-in Sessions',
  description: 'Invalidate all active Microsoft 365 sign-in sessions for a user.',
  action: { kind: 'revokeSessions' },
  actionLabel: ActionLabels.M365IdentityRevokeSessions,
  defaultUnitPrice: 0.02,
  operation: {
    source: 'openapi',
    operationId: 'user-revokeSignInSessions',
    method: 'POST',
    path: '/users/{userId}/revokeSignInSessions',
    parameters: [{ input: 'userId', name: 'userId', in: 'path', required: true }],
    successStatusCodes: [200, 204],
    response: { source: 'body' },
  },
});
