/**
 * Permission catalog & evaluator.
 *
 * PERMISSION_TREE is the single source of truth for every gated action across
 * the app and the audit target-type enumeration. Add a resource (or a
 * sub-resource under an integration) here and the type, evaluator, and audit
 * catalog all follow.
 *
 * Grants store dotted paths (`Vendors.M365.Identities.Write`). The evaluator
 * walks prefixes and honors action implication at each level, so a grant of
 * `Vendors.M365.Write` satisfies checks for `Vendors.M365.Identities.Read`
 * without the admin having to grant it twice.
 */

// ---------------------------------------------------------------------------
// Tree — source of truth. Leaves are `{}` unless a resource needs custom
// actions, in which case the node can declare `$actions`. Nesting is
// supported; sub-trees (e.g. Vendors.M365.Identities) land in Phase 2.
// ---------------------------------------------------------------------------

export const PERMISSION_TREE = {
  // Operational
  Sites: {},
  Assets: {},
  People: {},
  Wiki: {},
  Vendors: {},
  Packages: { $actions: ['Read', 'Write', 'Run', 'Delete'] as const },
  Policies: {},
  Frameworks: {},
  Billing: {},
  Findings: {},
  Reports: {},
  // Configuration
  Users: {},
  Roles: {},
  Integrations: {},
  Audit: {}
} as const;

const DEFAULT_ACTIONS = ['Read', 'Write', 'Delete'] as const;
export const ACTIONS = ['Read', 'Write', 'Run', 'Delete'] as const;
export type Action = (typeof ACTIONS)[number];

// ---------------------------------------------------------------------------
// Type derivation — dotted paths from the tree.
// ---------------------------------------------------------------------------

type ChildKeys<T> = Exclude<keyof T & string, '$actions'>;
type NodeAction<T> = T extends { $actions: readonly (infer A extends Action)[] }
  ? A
  : (typeof DEFAULT_ACTIONS)[number];
type NodePaths<T, Prefix extends string> = {
  [K in ChildKeys<T>]:
    | `${Prefix}${K}.${NodeAction<T[K]>}`
    | (ChildKeys<T[K]> extends never ? never : NodePaths<T[K], `${Prefix}${K}.`>);
}[ChildKeys<T>];

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

export type PermissionInput = readonly PermissionGrant[] | null;

export type PermissionResource = {
  key: string;
  label: string;
  depth: number;
  actions: readonly Action[];
};

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

// Delete > Write > Read for standard CRUD resources. Packages also expose Run
// as a child permission of Write, so Write/Delete satisfy Run checks.
const IMPLIES: Record<Action, readonly Action[]> = {
  Read: ['Read', 'Write', 'Delete'],
  Run: ['Run', 'Write', 'Delete'],
  Write: ['Write', 'Delete'],
  Delete: ['Delete']
};

function splitPermission(permission: string): { path: string[]; action: Action | null } {
  const parts = permission.split('.');
  const tail = parts[parts.length - 1];
  if (tail === 'Read' || tail === 'Write' || tail === 'Run' || tail === 'Delete') {
    return { path: parts.slice(0, -1), action: tail };
  }
  return { path: parts, action: null };
}

function actionsForNode(node: Record<string, unknown>): readonly Action[] {
  return Array.isArray(node.$actions) ? (node.$actions as readonly Action[]) : DEFAULT_ACTIONS;
}

function listPermissionResources(
  node: Record<string, unknown>,
  prefix: string[] = []
): PermissionResource[] {
  const out: PermissionResource[] = [];
  for (const [key, value] of Object.entries(node)) {
    if (key === '$actions' || !value || typeof value !== 'object' || Array.isArray(value)) continue;
    const path = [...prefix, key];
    out.push({
      key: path.join('.'),
      label: key,
      depth: prefix.length,
      actions: actionsForNode(value as Record<string, unknown>)
    });
    out.push(...listPermissionResources(value as Record<string, unknown>, path));
  }
  return out;
}

export const PERMISSION_RESOURCES: readonly PermissionResource[] = listPermissionResources(
  PERMISSION_TREE as Record<string, unknown>
);

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

function comparePermissions(a: string, b: string): number {
  if (a === '*') return -1;
  if (b === '*') return 1;
  if (a === 'Global.Admin') return -1;
  if (b === 'Global.Admin') return 1;

  const aParts = splitPermission(a);
  const bParts = splitPermission(b);
  const pathCmp = aParts.path.join('.').localeCompare(bParts.path.join('.'));
  if (pathCmp !== 0) return pathCmp;

  const rank = (action: Action | null): number => {
    if (action === 'Read') return 0;
    if (action === 'Run') return 1;
    if (action === 'Write') return 2;
    if (action === 'Delete') return 3;
    return 4;
  };
  return rank(aParts.action) - rank(bParts.action);
}

export function hasPermission(input: PermissionInput, required: Permission): boolean {
  if (!input) return false;

  for (const grant of input) {
    for (const granted of grant.permissions) {
      if (grantStringSatisfies(granted, required)) return true;
    }
  }
  // Global.Admin as a granted string implies everything.
  if (required !== 'Global.Admin') {
    for (const grant of input) {
      if (grant.permissions.includes('Global.Admin')) return true;
    }
  }
  return false;
}

export function hasAnyPermission(input: PermissionInput, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(input, p));
}

export function normalizePermissions(permissions: readonly string[]): string[] {
  const unique = [...new Set(permissions.filter(Boolean))];
  if (unique.includes('*')) return ['*'];
  if (unique.includes('Global.Admin')) return ['Global.Admin'];

  return unique
    .filter((permission, _, all) => {
      return !all.some((other) => other !== permission && grantStringSatisfies(other, permission));
    })
    .sort(comparePermissions);
}

// For route/nav gating: "does the caller have ANY permission under this
// prefix?" Prefix is a dotted path without an action, e.g. `Vendors` or
// `Vendors.M365`. Used by nav filters so a user with only
// `Vendors.M365.Identities.Read` still sees the `/vendors` group.
export function hasAnyPermissionUnder(input: PermissionInput, prefix: string): boolean {
  if (!input) return false;
  for (const grant of input) {
    for (const granted of grant.permissions) {
      if (granted === '*' || granted === 'Global.Admin') return true;
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
      'Findings.Delete',
      'Reports.Delete'
    ],
    isSystem: true
  },
  {
    name: 'Helpdesk',
    level: 2,
    description: 'Read across operational data; write access limited to Sites and Wiki.',
    permissions: [
      'Sites.Write',
      'Wiki.Write',
      'Assets.Read',
      'People.Read',
      'Vendors.Read',
      'Policies.Read',
      'Frameworks.Read',
      'Billing.Read',
      'Findings.Read',
      'Reports.Read'
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
      'Findings.Read',
      'Reports.Read'
    ],
    isSystem: true
  }
];
