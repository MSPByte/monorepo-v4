# Capability authoring guide

This document is the reference for writing and reviewing capabilities in
`packages/capabilities`. It covers what to decide for each field, which patterns
to use, and how human and AI responsibility divides across the workflow.

Read `OPENAPI_CAPABILITIES.md` for the import → review → scaffold tooling.
Read this document when you are filling in a scaffold or writing a capability
from scratch.

---

## Human vs. AI responsibilities

| Step | Owner | Notes |
|---|---|---|
| Select operations from vendor spec | Human | Determine which operations unlock real MSP value |
| Run `import:openapi` | Either | CLI tool, no judgment needed |
| Complete candidate body schemas | AI | Derive from vendor docs; flag unknowns as `z.unknown()` |
| Assign entity mappings and dynamic sources | AI | Use reference tables below; flag if unsure |
| Assign category, audit action, permission | AI | Use tables below; human confirms destructive ops |
| Confirm destructive operations | **Human required** | DELETE, disable, revoke must be explicitly approved |
| Confirm sensitive field markings | **Human required** | Credentials, tokens, passwords |
| Run `review:openapi --status approved` | Human | Signals explicit sign-off |
| Run `scaffold:openapi` | Either | CLI tool |
| Write handler body | AI | Using factory or custom pattern from guide below |
| Smoke-test against non-prod tenant | **Human required** | CLI cannot do this |
| Run `review:openapi --status live` | Human | Requires evidence from smoke test |
| Register in `registry.ts` | AI | Mechanical — add one line |

---

## Capability shape reference

### `category`

| Value | Use when |
|---|---|
| `identity` | Creates, modifies, or reads a user / identity object |
| `license` | Assigns or removes a software license |
| `group` | Creates or modifies a group / distribution list |
| `role` | Assigns or removes an admin or directory role |
| `device` | Acts on an endpoint, device, or agent |
| `admin` | Tenant-level or org-level configuration |
| `site` | Creates or links a site in a third-party platform |

### `auditAction`

| Value | Use when |
|---|---|
| `create` | The operation provisions a new resource |
| `update` | The operation modifies an existing resource |
| `delete` | The operation removes or destroys a resource |

### `requiredPermission`

Use the narrowest permission that covers the operation:

| Permission | Use when |
|---|---|
| `Vendors.Write` | Any capability that calls a vendor API (default for all write operations) |
| `Vendors.Read` | Read-only vendor operations surfaced to package authors |

Do not invent new permission strings. If you need a new one, add it to
`packages/shared` in a separate change.

### `actionLabel`

Every capability needs an `ActionLabels` enum value from
`packages/shared/src/config/actions/index.ts`. Current vendor-capability values:

```
M365IdentityRevokeSessions  M365IdentityDisable     M365IdentityEnable
M365IdentityForcePasswordChange                     M365IdentityResetPassword
M365IdentityRequireMfaReset M365IdentityDeleteAuthMethod
M365GroupCreate              M365IdentityGroupAdd    M365IdentityGroupRemove
M365ConditionalAccessPolicyCreate
M365IdentityLicenseAdd       M365IdentityLicenseRemove
M365IdentityRoleAdd          M365IdentityRoleRemove
SophosEndpointDelete         SophosEndpointTamperEnable  SophosEndpointTamperDisable
SophosEndpointTamperSet      SophosEndpointUpgrade   SophosPartnerSiteCreate
DattoSiteCreate              CoveSiteCreate          CoreSiteProvision
CoreHaloPSATicketCreate      CoreHaloPSATicketAddNote
```

For a new capability, add a new enum value following the pattern
`{Vendor}{Resource}{Verb}` (e.g. `M365IdentityCreate`) before wiring it. The
value string follows `vendor.resource.verb` (e.g. `'m365.identity.create'`).

---

## `inputMeta` field reference

Every exposed input needs an entry. Required fields: `allowedBindings`. Others
depend on type.

### `allowedBindings`

Pick the narrowest set that makes sense for the field:

| Binding | When to include |
|---|---|
| `literal` | The author can type a value at design time |
| `runtime` | An operator fills it in at run time (form input) |
| `entity` | The value is a MSPByte entity picked from a list |
| `priorOutput` | The value can be wired from an earlier step's output |
| `siteFact` | The value can be read from the run's site profile facts |
| `generated` | The platform generates the value (passwords only) |
| `failureContext` | The value comes from a failure context (failure-lane steps only) |

Common combinations:
- **Primitive config field** (e.g. country code): `['literal', 'runtime', 'siteFact']`
- **Entity reference** (e.g. identity, group): `['entity', 'priorOutput', 'runtime']`
- **Sensitive credential**: `['literal', 'runtime', 'generated']`
- **Boolean flag**: `['literal', 'runtime', 'siteFact']`

### `entityType` values (registered)

Use these for inputs that reference a MSPByte entity. The picker UI uses this
to scope the entity list correctly.

| Value | Resolves to |
|---|---|
| `site` | A MSPByte site |
| `integration_link` | An active integration link (e.g. a specific M365 tenant link) |
| `m365_identity` | A Microsoft 365 user (from `vendors.m365_identities`) |
| `m365_group` | A Microsoft 365 group (from `vendors.m365_groups`) |
| `m365_license` | A Microsoft 365 subscribed SKU (from `vendors.m365_licenses`) |
| `m365_role` | A Microsoft 365 directory role (from `vendors.m365_roles`) |

Do not invent new entity types. If you need one, add it to the picker
infrastructure in a separate change.

### `dynamicSource` values (registered)

Use these for closed-choice dropdowns populated at run time from the tenant:

| Value | Populates |
|---|---|
| `m365DomainOptions` | Verified domains for a Microsoft 365 tenant |
| `coveChildPartners` | Cove child partners visible to the root account |
| `halopsaTicketTypes` | HaloPSA ticket type list |
| `halopsaTicketPriorities` | HaloPSA priority list |
| `halopsaTicketCategories` | HaloPSA category list |

### `typeHint` values

| Value | Renders as |
|---|---|
| `text` | Plain text input |
| `boolean` | Checkbox / toggle |
| `number` | Numeric input |
| `stringArray` | Tag / chip input |
| `password` | Password input (auto-masked) |
| `upn` | UPN-aware text input |
| `postalCode` | Postal code with autofill |
| `city` / `countryCode` / `state` | Address autofill targets |

### `sensitive`

Set `sensitive: true` on: passwords, tokens, API keys, connection strings, and
any output that contains credentials. The worker encrypts sensitive output
values at rest and creates a reveal audit log entry when they are read.

### `required` and `advanced`

- `required: false` — optional input; form hides it behind an Advanced toggle.
- `advanced: true` — requires `required: false`; collapsed by default in forms.

Omitting `required` defaults to `true` for backwards compatibility.

---

## `outputMeta` field reference

Every output field needs an entry with at least a `label`. Add `outputType` for
fields that downstream steps should be able to wire to. These are the registered
`outputType` strings:

| `outputType` | Meaning |
|---|---|
| `m365_identity_internal_id` | MSPByte internal UUID for an M365 user |
| `m365_identity_external_id` | Microsoft Graph user ID |
| `m365_identity_upn` | User principal name |

For other outputs, omit `outputType` and describe the value with `label` and
`description` only. Do not invent new `outputType` strings; add them in a
separate change if you need a new wire-compatibility tag.

---

## Handler patterns

### Pattern 1 — Graph identity operation (use this first)

Use `defineGraphIdentityOperation` from `src/m365/identity-openapi.ts` when:
- Input is a single `identityId` (MSPByte UUID of an M365 user)
- Output is `{ externalId, name }` (Graph user ID and display name)
- The operation is a PATCH or an action POST against `/users/{userId}/...`
- No write-through to the DB is needed

```typescript
import { ActionLabels } from '@mspbyte/shared';
import { defineGraphIdentityOperation } from './identity-openapi.js';

export const m365IdentityFoo = defineGraphIdentityOperation({
  id: 'm365.identity.foo',
  name: 'Foo M365 Identity',
  description: 'Does foo to the user.',
  action: { kind: 'setAccountEnabled', enabled: true }, // or 'revokeSessions'
  actionLabel: ActionLabels.M365IdentityFoo,
  defaultUnitPrice: 0.02,
  operation: {
    source: 'openapi',
    operationId: 'user-foo',
    method: 'PATCH',
    path: '/users/{userId}',
    parameters: [{ input: 'userId', name: 'userId', in: 'path', required: true }],
    body: { input: 'body', contentType: 'application/json' },
    successStatusCodes: [204],
    response: { source: 'body' },
  },
});
```

To add a new `action` kind, extend the `IdentityAction` union in
`src/m365/identity-openapi.ts` and handle it in the factory's handler.

### Pattern 2 — Generic OpenAPI capability with custom handler

Use `defineOpenApiCapability` when the operation has different inputs, needs
body field mapping, or requires write-through to the DB.

```typescript
import { z } from 'zod';
import { buildOpenApiRequest, defineOpenApiCapability } from '../openapi.js';
import { classifyGraphError } from './classify-error.js';
import { ActionLabels } from '@mspbyte/shared';

const inputs = z.object({ identityId: z.uuid(), groupId: z.uuid() });
const outputs = z.object({ groupExternalId: z.string() });

export const m365GroupAddMemberExample = defineOpenApiCapability({
  id: 'm365.group.member.add',
  vendor: 'microsoft-365',
  integration: { integrationId: 'microsoft-365', connection: 'activeLink' },
  name: 'Add Member to Group',
  description: 'Adds a Microsoft 365 user to a group.',
  category: 'group',
  operation: {
    source: 'openapi',
    operationId: 'group-addMember',
    method: 'POST',
    path: '/groups/{groupId}/members/$ref',
    parameters: [{ input: 'groupId', name: 'groupId', in: 'path', required: true }],
    body: { input: 'body', contentType: 'application/json' },
    successStatusCodes: [204],
    response: { source: 'body' },
  },
  inputs,
  outputs,
  inputMeta: { /* ... */ },
  outputMeta: { /* ... */ },
  actionLabel: ActionLabels.M365IdentityGroupAdd,
  auditAction: 'update',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.02,
  async handler(ctx, input) {
    // 1. Resolve MSPByte entity IDs to vendor external IDs
    const identity = await ctx.loadM365Identity(input.identityId);
    if (!identity) return { outcome: 'fail', errorClass: 'not_found', message: 'Identity not found' };

    try {
      // 2. Build and execute the request
      const request = buildOpenApiRequest(m365GroupAddMemberExample.operation, {
        groupId: '<external-group-id>',
        body: { '@odata.id': `https://graph.microsoft.com/v1.0/users/${identity.externalId}` },
      });
      const connector = await ctx.getM365Connector(identity.linkId);
      const result = await connector.operations.execute(request);
      if (!m365GroupAddMemberExample.operation.successStatusCodes.includes(result.status)) {
        return { outcome: 'fail', errorClass: 'vendor_error', message: `Unexpected status ${result.status}` };
      }
      return { outcome: 'success', outputs: { groupExternalId: '<group-external-id>' } };
    } catch (error) {
      return classifyGraphError(error);
    }
  },
});
```

### Pattern 3 — Curated capability

Use a plain `Capability` when:
- Multiple vendor API calls are needed in one step
- Complex input transformation is required
- Write-through to `vendors.*` tables is needed (e.g. `ctx.upsertM365Identity`)
- The operation doesn't map cleanly to a single OpenAPI endpoint

See `src/m365/create-identity.ts` or `src/m365/assign-license.ts` as examples.

### Error classification for Graph operations

Import and use the shared classifier for any handler calling Graph:

```typescript
import { classifyGraphError } from './classify-error.js';

try {
  // ... connector call
} catch (error) {
  return classifyGraphError(error);
}
```

`classifyGraphError` parses the HTTP status from the Graph client error message
and maps it to the curated `ErrorClass` taxonomy. It also handles `failParent`
(credential failure) as a non-retryable `permission_denied` result.

---

## Registering a capability

After implementing, wire up three things:

**1. Vendor index** (`src/m365/index.ts` or equivalent):
```typescript
export { m365IdentityFoo } from './foo.js';
```

**2. Registry** (`src/registry.ts`):
```typescript
import { m365IdentityFoo } from './m365/foo.js';

export const CAPABILITIES = {
  // ...existing entries...
  [m365IdentityFoo.id]: m365IdentityFoo,
} as const satisfies Record<string, AnyCapability>;
```

**3. Type check**:
```sh
bun run check-types --filter=@mspbyte/capabilities
```

---

## Complete worked example

**Candidate** (from `generated/microsoft-graph-v1.0-user-operations.candidates.json`):
```json
{
  "id": "microsoft-365.users-user-get-user",
  "operation": { "method": "GET", "path": "/users/{id}", ... }
}
```

**Decision log** (what a human + AI review produces):
- Category: `identity` (reads a user object)
- `auditAction`: `update` (GET operations use update by convention — no resource mutation)
- `requiredPermission`: `Vendors.Write` (standard for vendor operations)
- `actionLabel`: needs `M365IdentityRead` added to `ActionLabels`
- Input `id`: map to `identityId` with `entityType: 'm365_identity'`, resolve to `externalId` in handler
- Output: project `{ id, displayName, userPrincipalName, accountEnabled }`
- Sensitive: none
- Idempotent: yes (GET)
- Destructive: no

**Verdict**: Use Pattern 2 (custom handler needed to resolve `identityId → externalId`).
Destructive: no — can proceed without escalated human review.

---

## What to flag for human review

Always escalate to a human before approving:

- Any `DELETE` operation or operation whose description mentions "delete",
  "remove", "destroy", or "wipe"
- Any `auditAction: 'delete'`
- Any field marked `sensitive: true` — confirm the field truly contains credentials
- Any `dynamicSource` or `entityType` value not in the tables above (it may need platform work)
- Any body field whose purpose is ambiguous from the vendor docs
- Any operation that requires a permission scope not in the registered list above
