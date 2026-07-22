/**
 * Permission catalog & evaluator.
 *
 * PERMISSION_TREE is the single source of truth for every gated action across
 * the app and the audit target-type enumeration. Add a resource (or a
 * sub-resource under an integration) here and the type, evaluator, and audit
 * catalog all follow.
 *
 * Grants store dotted paths (`Vendors.M365.Identities.Write`). The evaluator
 * walks prefixes and honors Delete > Write > Read implication at each level,
 * so a grant of `Vendors.M365.Write` satisfies checks for
 * `Vendors.M365.Identities.Read` without the admin having to grant it twice.
 */

// ---------------------------------------------------------------------------
// Tree — source of truth. Leaves are `{}`. Nesting is supported; sub-trees
// (e.g. Vendors.M365.Identities) land in Phase 2.
// ---------------------------------------------------------------------------

export const PERMISSION_TREE = {
  // Operational
  Sites: {},
  Assets: {},
  People: {},
  Wiki: {},
  Vendors: {},
  Policies: {},
  Frameworks: {},
  Billing: {},
  Findings: {},
  // Configuration
  Users: {},
  Roles: {},
  Integrations: {},
  Audit: {}
} as const;

export const ACTIONS = ['Read', 'Write', 'Delete'] as const;
export type Action = (typeof ACTIONS)[number];

// Retained for callers that still import RESOURCES. New code should derive from
// PERMISSION_TREE instead. Removed in Stage 4.
export const RESOURCES = ['Sites', 'Integrations', 'Users', 'Assets'] as const;

// ---------------------------------------------------------------------------
// Type derivation — dotted paths from the tree.
// ---------------------------------------------------------------------------

type NodePaths<T, Prefix extends string> = {
  [K in keyof T & string]:
    | `${Prefix}${K}.${Action}`
    | (keyof T[K] extends never ? never : NodePaths<T[K], `${Prefix}${K}.`>);
}[keyof T & string];

export type ResourcePermission = NodePaths<typeof PERMISSION_TREE, ''>;
export type GlobalPermission = 'Global.Admin';
export type Permission = GlobalPermission | ResourcePermission;

// ---------------------------------------------------------------------------
// Grants & scope.
// ---------------------------------------------------------------------------

export type Scope =
  | { kind: 'all' }
  | { kind: 'sites'; ids: readonly string[] }
  | { kind: 'groups'; ids: readonly string[] };

export type PermissionGrant = {
  permissions: readonly string[];
  scope: Scope;
};

export type LegacyAttributes = Record<string, boolean> | null;

// Union accepted by the evaluator. `null` is treated as no grants.
export type PermissionInput = LegacyAttributes | readonly PermissionGrant[];

// ---------------------------------------------------------------------------
// Levels.
// ---------------------------------------------------------------------------

export const ROLE_LEVELS = [
  { value: 1, label: 'Auditor' },
  { value: 2, label: 'Helpdesk' },
  { value: 3, label: 'Support' },
  { value: 4, label: 'Administrator' },
  { value: 5, label: 'Global Administrator' }
] as const;

export function canActOnLevel(
  myLevel: number | null | undefined,
  targetLevel: number | null | undefined
): boolean {
  if (myLevel == null || targetLevel == null) return false;
  return myLevel >= targetLevel;
}

// ---------------------------------------------------------------------------
// Evaluator.
// ---------------------------------------------------------------------------

// Delete > Write > Read. If required=Read, having Write or Delete on the same
// node satisfies. If required=Write, Delete satisfies. If required=Delete, only
// Delete satisfies.
const IMPLIES: Record<Action, readonly Action[]> = {
  Read: ['Read', 'Write', 'Delete'],
  Write: ['Write', 'Delete'],
  Delete: ['Delete']
};

function splitPermission(permission: string): { path: string[]; action: Action | null } {
  const parts = permission.split('.');
  const tail = parts[parts.length - 1];
  if (tail === 'Read' || tail === 'Write' || tail === 'Delete') {
    return { path: parts.slice(0, -1), action: tail };
  }
  return { path: parts, action: null };
}

// Returns true if a single grant string (e.g. `Vendors.M365.Write` or
// `Vendors.*` or `*`) satisfies the required permission.
function grantStringSatisfies(granted: string, required: string): boolean {
  if (granted === '*') return true;
  if (granted === required) return true;

  // Wildcard grants — e.g. `Vendors.M365.*` or `Vendors.*`
  if (granted.endsWith('.*')) {
    const prefixParts = granted.slice(0, -2).split('.');
    const reqParts = required.split('.');
    if (reqParts.length < prefixParts.length) return false;
    for (let i = 0; i < prefixParts.length; i++) {
      if (reqParts[i] !== prefixParts[i]) return false;
    }
    return true;
  }

  // Exact-path grant with action — apply implication.
  const req = splitPermission(required);
  const grant = splitPermission(granted);
  if (grant.action && req.action) {
    // Path must match exactly OR grant path must be a strict prefix of required
    // path (Vendors.M365.Write covers Vendors.M365.Identities.Read).
    const grantPath = grant.path;
    const reqPath = req.path;
    if (grantPath.length > reqPath.length) return false;
    for (let i = 0; i < grantPath.length; i++) {
      if (grantPath[i] !== reqPath[i]) return false;
    }
    return IMPLIES[req.action].includes(grant.action);
  }

  return false;
}

// Legacy boolean bag path — preserves prior behavior and additionally honors
// `attributes['*'] === true` as allow-all (fixes the Owner-seed hole).
function hasPermissionLegacy(attributes: LegacyAttributes, permission: Permission): boolean {
  if (!attributes) return false;
  if (attributes['*'] === true) return true;
  if (attributes['Global.Admin'] === true) return true;
  if (attributes[permission] === true) return true;
  if (permission.endsWith('.Read')) {
    const writePerm = permission.replace('.Read', '.Write');
    if (attributes[writePerm] === true) return true;
    const deletePerm = permission.replace('.Read', '.Delete');
    if (attributes[deletePerm] === true) return true;
  }
  if (permission.endsWith('.Write')) {
    const deletePerm = permission.replace('.Write', '.Delete');
    if (attributes[deletePerm] === true) return true;
  }
  return false;
}

function isGrantList(input: PermissionInput): input is readonly PermissionGrant[] {
  return Array.isArray(input);
}

export function hasPermission(input: PermissionInput, required: Permission): boolean {
  if (input === null || input === undefined) return false;

  if (isGrantList(input)) {
    for (const grant of input) {
      for (const granted of grant.permissions) {
        if (grantStringSatisfies(granted, required)) return true;
      }
    }
    // Global.Admin is a permission string; grants may include it directly.
    if (required !== 'Global.Admin') {
      for (const grant of input) {
        if (grant.permissions.includes('Global.Admin')) return true;
      }
    }
    return false;
  }

  return hasPermissionLegacy(input, required);
}

export function hasAnyPermission(input: PermissionInput, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(input, p));
}

// For route/nav gating: "does the caller have ANY permission under this
// prefix?" Prefix is a dotted path without an action, e.g. `Vendors` or
// `Vendors.M365`. Used by nav filters so a user with only
// `Vendors.M365.Identities.Read` still sees the `/vendors` group.
export function hasAnyPermissionUnder(input: PermissionInput, prefix: string): boolean {
  if (input === null || input === undefined) return false;

  if (isGrantList(input)) {
    for (const grant of input) {
      for (const granted of grant.permissions) {
        if (granted === '*') return true;
        if (granted === prefix || granted.startsWith(prefix + '.')) return true;
        // A wildcard grant at or above the prefix also counts.
        if (granted.endsWith('.*')) {
          const wildBase = granted.slice(0, -2);
          if (prefix === wildBase || prefix.startsWith(wildBase + '.')) return true;
        }
      }
    }
    return false;
  }

  // Legacy bag — check any key that starts with the prefix.
  if (input['*'] === true) return true;
  if (input['Global.Admin'] === true) return true;
  for (const key of Object.keys(input)) {
    if (input[key] !== true) continue;
    if (key === prefix || key.startsWith(prefix + '.')) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// System role catalog. Seeded per-tenant by infra/scripts tenant-seed.
// Owner (level 100, ['*']) is minted by the provisioning script, not here.
// ---------------------------------------------------------------------------

export type SystemRole = {
  name: string;
  level: number;
  description: string;
  permissions: readonly string[];
  isSystem: true;
};

export const SYSTEM_ROLES: readonly SystemRole[] = [
  {
    name: 'Global Administrator',
    level: 5,
    description: 'Full access to everything, including other Global Administrators.',
    permissions: ['*'],
    isSystem: true
  },
  {
    name: 'Administrator',
    level: 4,
    description:
      'Full access to everything. Cannot act on Global Administrator accounts (enforced by level).',
    permissions: ['*'],
    isSystem: true
  },
  {
    name: 'Support',
    level: 3,
    description:
      'Full read/write/delete on operational data. No access to configuration surfaces (Users, Roles, Integrations, Audit).',
    permissions: [
      'Sites.Delete',
      'Assets.Delete',
      'People.Delete',
      'Wiki.Delete',
      'Vendors.Delete',
      'Policies.Delete',
      'Frameworks.Delete',
      'Billing.Delete',
      'Findings.Delete'
    ],
    isSystem: true
  },
  {
    name: 'Helpdesk',
    level: 2,
    description:
      'Read across operational data; write access limited to Sites and Wiki.',
    permissions: [
      'Sites.Write',
      'Wiki.Write',
      'Assets.Read',
      'People.Read',
      'Vendors.Read',
      'Policies.Read',
      'Frameworks.Read',
      'Billing.Read',
      'Findings.Read'
    ],
    isSystem: true
  },
  {
    name: 'Auditor',
    level: 1,
    description: 'Read-only access to operational data.',
    permissions: [
      'Sites.Read',
      'Assets.Read',
      'People.Read',
      'Wiki.Read',
      'Vendors.Read',
      'Policies.Read',
      'Frameworks.Read',
      'Billing.Read',
      'Findings.Read'
    ],
    isSystem: true
  }
];

