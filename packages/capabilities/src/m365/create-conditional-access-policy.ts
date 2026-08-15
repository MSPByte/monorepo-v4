import { z } from 'zod';
import { ActionLabels } from '@mspbyte/shared';
import type { Capability, CapabilityCtx } from '../types.js';

// Accepts either a single Graph ID (from a priorOutput wire) or an array (from
// a multi-select entity picker). The handler coerces both to string[].
const idList = z.union([z.string().min(1), z.array(z.string().min(1))]).optional();

const inputs = z.object({
  tenantLinkId: z.uuid(),
  displayName: z.string().min(1).max(256),
  state: z.enum(['enabled', 'disabled', 'enabledForReportingButNotEnforced']),

  // --- User / group / role conditions ---
  // When includeAllUsers is true the policy targets every user ('All') and the
  // three include-picker fields are ignored.
  includeAllUsers: z.boolean(),
  includeUserIds: idList,
  includeGroupIds: idList,
  includeRoleIds: idList,
  // Exclude fields accept both entity-picker arrays and single priorOutput wires.
  excludeUserIds: idList,
  excludeGroupIds: idList,
  excludeRoleIds: idList,

  // --- Application conditions ---
  includeAllApplications: z.boolean(),
  includeApplicationIds: z.array(z.string().min(1)).optional(),
  excludeApplicationIds: z.array(z.string().min(1)).optional(),

  // --- Grant controls ---
  // Each control maps to a Graph builtInControl value.
  requireMfa: z.boolean().optional(),
  requireCompliantDevice: z.boolean().optional(),
  requireDomainJoinedDevice: z.boolean().optional(),
  requireApprovedApp: z.boolean().optional(),
  requireAppProtectionPolicy: z.boolean().optional(),
  blockAccess: z.boolean().optional(),
  // Operator only matters when multiple controls are selected.
  grantOperator: z.enum(['AND', 'OR']).optional(),

  // --- Session controls ---
  signInFrequencyEnabled: z.boolean().optional(),
  signInFrequencyValue: z.number().int().min(1).optional(),
  signInFrequencyType: z.enum(['days', 'hours']).optional(),
  persistentBrowserEnabled: z.boolean().optional(),
  persistentBrowserMode: z.enum(['always', 'never']).optional(),
});

const outputs = z.object({
  externalId: z.string(),
  internalId: z.string(),
  name: z.string(),
});

function toArr(val: string | string[] | undefined): string[] {
  if (!val) return [];
  return Array.isArray(val) ? val : [val];
}

// m365_identity pickers return our internal DB UUID; priorOutput wires from
// m365.identity.create return the Graph user objectId directly. We try a DB
// lookup — if found, swap to externalId; otherwise pass the value through.
async function resolveUserIds(ctx: CapabilityCtx, ids: string[]): Promise<string[]> {
  return Promise.all(ids.map(async (id) => {
    const row = await ctx.loadM365Identity(id);
    return row?.externalId ?? id;
  }));
}

export const m365ConditionalAccessPolicyCreate: Capability<
  z.infer<typeof inputs>,
  z.infer<typeof outputs>
> = {
  id: 'm365.conditional-access.policy.create',
  vendor: 'microsoft-365',
  name: 'Create Conditional Access Policy',
  description:
    'Create a Microsoft Entra Conditional Access policy. Requires Entra ID P1/P2. Returns the policy id.',
  category: 'admin',
  inputs,
  outputs,
  inputMeta: {
    tenantLinkId: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'integration_link',
      typeHint: 'text',
      label: 'Tenant',
      required: true,
    },
    displayName: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'text',
      label: 'Policy name',
      required: true,
    },
    state: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'State',
      description: 'Start in report-only mode to verify impact before enforcing.',
      required: true,
      defaultValue: 'enabledForReportingButNotEnforced',
      choices: [
        { value: 'enabledForReportingButNotEnforced', label: 'Report-only (recommended)' },
        { value: 'enabled', label: 'Enabled' },
        { value: 'disabled', label: 'Disabled' },
      ],
    },

    // User conditions
    includeAllUsers: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'boolean',
      label: 'Include all users',
      description: 'When on, the policy targets every user. Turn off to pick specific users or groups.',
      required: true,
      defaultValue: true,
    },
    includeUserIds: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'm365_identity',
      typeHint: 'stringArray',
      label: 'Include specific users',
      description: 'Only used when "Include all users" is off.',
      required: false,
      advanced: true,
    },
    includeGroupIds: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'm365_group',
      typeHint: 'stringArray',
      label: 'Include specific groups',
      description: 'Only used when "Include all users" is off.',
      required: false,
      advanced: true,
    },
    includeRoleIds: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'm365_role',
      typeHint: 'stringArray',
      label: 'Include roles',
      description: 'Target users assigned these directory roles.',
      required: false,
      advanced: true,
    },
    excludeUserIds: {
      allowedBindings: ['entity', 'literal', 'runtime', 'priorOutput'],
      entityType: 'm365_identity',
      typeHint: 'stringArray',
      priorOutputCompat: ['m365_identity_external_id'],
      label: 'Exclude users',
      description: 'Exclude specific users (e.g. a breakglass account). Wire from a create-identity step or pick from the tenant.',
      required: false,
    },
    excludeGroupIds: {
      allowedBindings: ['entity', 'literal', 'runtime', 'priorOutput'],
      entityType: 'm365_group',
      typeHint: 'stringArray',
      priorOutputCompat: ['m365_group_external_id'],
      label: 'Exclude groups',
      description: 'Exclude group members (e.g. an MFA-exempt group). Wire from a create-group step or pick an existing group.',
      required: false,
    },
    excludeRoleIds: {
      allowedBindings: ['entity', 'literal', 'runtime'],
      entityType: 'm365_role',
      typeHint: 'stringArray',
      label: 'Exclude roles',
      description: 'Exclude users holding these directory roles.',
      required: false,
      advanced: true,
    },

    // Application conditions
    includeAllApplications: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'boolean',
      label: 'Include all cloud apps',
      required: true,
      defaultValue: true,
    },
    includeApplicationIds: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'stringArray',
      label: 'Include specific app IDs',
      description: 'Microsoft app client IDs when "Include all cloud apps" is off.',
      required: false,
      advanced: true,
    },
    excludeApplicationIds: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'stringArray',
      label: 'Exclude app IDs',
      required: false,
      advanced: true,
    },

    // Grant controls
    requireMfa: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Require MFA',
      required: false,
      defaultValue: false,
    },
    requireCompliantDevice: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Require compliant device',
      required: false,
      defaultValue: false,
      advanced: true,
    },
    requireDomainJoinedDevice: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Require hybrid Azure AD joined device',
      required: false,
      defaultValue: false,
      advanced: true,
    },
    requireApprovedApp: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Require approved client app',
      required: false,
      defaultValue: false,
      advanced: true,
    },
    requireAppProtectionPolicy: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Require app protection policy (Intune MAM)',
      required: false,
      defaultValue: false,
      advanced: true,
    },
    blockAccess: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Block access',
      description: 'Block sign-in entirely (mutually exclusive with other grant controls).',
      required: false,
      defaultValue: false,
      advanced: true,
    },
    grantOperator: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Grant operator',
      description: 'When multiple grant controls are selected: require all (AND) or any one (OR).',
      required: false,
      defaultValue: 'OR',
      advanced: true,
      choices: [
        { value: 'OR', label: 'OR — any control satisfies the policy' },
        { value: 'AND', label: 'AND — all controls must be satisfied' },
      ],
    },

    // Session controls
    signInFrequencyEnabled: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Enable sign-in frequency',
      required: false,
      defaultValue: false,
      advanced: true,
    },
    signInFrequencyValue: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'number',
      label: 'Sign-in frequency value',
      required: false,
      advanced: true,
    },
    signInFrequencyType: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Sign-in frequency unit',
      required: false,
      advanced: true,
      choices: [
        { value: 'days', label: 'Days' },
        { value: 'hours', label: 'Hours' },
      ],
    },
    persistentBrowserEnabled: {
      allowedBindings: ['literal', 'runtime', 'siteFact'],
      typeHint: 'boolean',
      label: 'Enable persistent browser session control',
      required: false,
      defaultValue: false,
      advanced: true,
    },
    persistentBrowserMode: {
      allowedBindings: ['literal', 'runtime'],
      typeHint: 'text',
      label: 'Persistent browser mode',
      required: false,
      advanced: true,
      choices: [
        { value: 'never', label: 'Never (force re-auth on new browser session)' },
        { value: 'always', label: 'Always (stay signed in)' },
      ],
    },
  },
  outputMeta: {
    externalId: { label: 'Graph policy id', outputType: 'm365_policy_external_id' },
    internalId: { label: 'Internal policy id', outputType: 'm365_policy_internal_id' },
    name: { label: 'Policy display name' },
  },
  actionLabel: ActionLabels.M365ConditionalAccessPolicyCreate,
  auditAction: 'create',
  requiredPermission: 'Vendors.Write',
  defaultUnitPrice: 0.1,
  async handler(ctx, input) {
    // --- Resolve user IDs ---
    // m365_identity entity pickers return our internal DB UUID; resolveUserIds
    // swaps those for the Graph externalId. Values already in Graph ID form
    // (from priorOutput or literals) pass through unchanged.
    const rawExcludeUsers = toArr(input.excludeUserIds);
    const excludeUsers = await resolveUserIds(ctx, rawExcludeUsers);

    const rawIncludeUsers = toArr(input.includeUserIds);
    const includeUsers = input.includeAllUsers
      ? ['All']
      : (await resolveUserIds(ctx, rawIncludeUsers)).length > 0
        ? await resolveUserIds(ctx, rawIncludeUsers)
        : toArr(input.includeGroupIds).length > 0 || toArr(input.includeRoleIds).length > 0
          ? []
          : ['All']; // fall back to All if nothing specified

    // m365_group entity pickers now return externalId directly (Graph group object ID).
    const excludeGroups = toArr(input.excludeGroupIds);
    const includeGroups = input.includeAllUsers ? [] : toArr(input.includeGroupIds);
    const includeRoles = input.includeAllUsers ? [] : toArr(input.includeRoleIds);
    const excludeRoles = toArr(input.excludeRoleIds);

    // --- Application conditions ---
    const includeApplications = input.includeAllApplications
      ? ['All']
      : (input.includeApplicationIds ?? []).length > 0
        ? (input.includeApplicationIds ?? [])
        : ['All'];
    const excludeApplications = input.excludeApplicationIds ?? [];

    // --- Grant controls ---
    const controls: string[] = [];
    if (input.requireMfa) controls.push('mfa');
    if (input.requireCompliantDevice) controls.push('compliantDevice');
    if (input.requireDomainJoinedDevice) controls.push('domainJoinedDevice');
    if (input.requireApprovedApp) controls.push('approvedApplication');
    if (input.requireAppProtectionPolicy) controls.push('compliantApplication');
    if (input.blockAccess) controls.push('block');

    const grantControls =
      controls.length > 0
        ? { operator: input.grantOperator ?? 'OR', builtInControls: controls }
        : null;

    // --- Session controls ---
    let sessionControls: Record<string, unknown> | null = null;
    const hasSignInFreq = input.signInFrequencyEnabled && input.signInFrequencyValue;
    const hasPersistentBrowser = input.persistentBrowserEnabled && input.persistentBrowserMode;

    if (hasSignInFreq || hasPersistentBrowser) {
      sessionControls = {};
      if (hasSignInFreq) {
        sessionControls.signInFrequency = {
          isEnabled: true,
          type: input.signInFrequencyType ?? 'hours',
          value: input.signInFrequencyValue,
          frequencyInterval: 'timeBased',
        };
      }
      if (hasPersistentBrowser) {
        sessionControls.persistentBrowser = {
          isEnabled: true,
          mode: input.persistentBrowserMode,
        };
      }
    }

    const conditions: Record<string, unknown> = {
      users: {
        includeUsers,
        excludeUsers,
        includeGroups,
        excludeGroups,
        includeRoles,
        excludeRoles,
      },
      applications: {
        includeApplications,
        excludeApplications,
      },
    };

    try {
      const connector = await ctx.getM365Connector(input.tenantLinkId);
      const result = await connector.conditionalAccess.createPolicy({
        displayName: input.displayName,
        state: input.state,
        conditions,
        grantControls,
        sessionControls,
      });

      // Write-through: persist immediately so the UI and downstream steps see it.
      let internalId = result.id;
      try {
        const row = await ctx.upsertM365Policy({
          linkId: input.tenantLinkId,
          externalId: result.id,
          name: result.displayName,
          policyState: input.state,
          conditions,
          grantControls: grantControls ?? undefined,
          sessionControls: sessionControls ?? undefined,
        });
        internalId = row.id;
      } catch {
        // DB write failed — sync will catch it; use externalId as fallback.
      }

      return {
        outcome: 'success',
        outputs: { externalId: result.id, internalId, name: result.displayName },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      let errorClass: 'permission_denied' | 'rate_limited' | 'invalid_input' | 'vendor_error' =
        'vendor_error';
      if (message.includes(' 403')) errorClass = 'permission_denied';
      else if (message.includes(' 429')) errorClass = 'rate_limited';
      else if (message.includes(' 400')) errorClass = 'invalid_input';
      return {
        outcome: 'fail',
        errorClass,
        message,
        retryable: errorClass === 'rate_limited' || errorClass === 'vendor_error',
      };
    }
  },
};
