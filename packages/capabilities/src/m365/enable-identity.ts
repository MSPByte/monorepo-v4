import { ActionLabels } from '@mspbyte/shared';
import { defineGraphIdentityOperation } from './identity-openapi.js';

export const m365IdentityEnable = defineGraphIdentityOperation({
  id: 'm365.identity.enable',
  name: 'Enable M365 Identity',
  description: 'Set accountEnabled=true on a Microsoft 365 user.',
  action: { kind: 'setAccountEnabled', enabled: true },
  actionLabel: ActionLabels.M365IdentityEnable,
  defaultUnitPrice: 0.02,
  operation: {
    source: 'openapi',
    operationId: 'user-update',
    method: 'PATCH',
    path: '/users/{userId}',
    parameters: [{ input: 'userId', name: 'userId', in: 'path', required: true }],
    body: { input: 'body', contentType: 'application/json' },
    successStatusCodes: [204],
    response: { source: 'body' },
  },
});
