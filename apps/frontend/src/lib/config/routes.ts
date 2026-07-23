import {
  hasPermission,
  hasAnyPermissionUnder,
  type Permission,
  type PermissionGrant,
} from '@mspbyte/shared';

export type RoutePermission = Permission | { prefix: string };

export type Route = {
  label: string;
  href: string;
  permission: RoutePermission;
  group?: string;
  devOnly?: boolean;
};

// Permission fields accept either a concrete Permission (`Users.Read`) or a
// tree prefix (`{ prefix: 'Vendors' }`) so a group can render when the caller
// has *any* grant under the subtree. Prefixes are used by nav groups whose
// children ship in Phase 2 (per-integration entries under Vendors).
const ROUTES: Route[] = [
  { label: 'Overview', href: '/home', permission: 'Assets.Read' },
  { label: 'Findings', href: '/findings', permission: 'Findings.Read' },
  { label: 'Sites', href: '/sites', permission: 'Sites.Read' },
  { label: 'Groups', href: '/groups', permission: 'Sites.Read' },
  { label: 'Assets', href: '/assets', permission: 'Assets.Read' },
  { label: 'People', href: '/people', permission: 'People.Read' },
  { label: 'Policies', href: '/policies', permission: 'Policies.Read' },
  { label: 'Frameworks', href: '/frameworks', permission: 'Frameworks.Read' },
  { label: 'Billing', href: '/billing', permission: 'Billing.Read' },
  { label: 'Wiki', href: '/wiki', permission: 'Wiki.Read' },
  { label: 'Users', href: '/setup/users', permission: 'Users.Read', group: 'Setup' },
  { label: 'Roles', href: '/setup/roles', permission: 'Roles.Read', group: 'Setup' },
  { label: 'Sites', href: '/setup/sites', permission: 'Sites.Write', group: 'Setup' },
  {
    label: 'Integrations',
    href: '/setup/integrations',
    permission: 'Integrations.Read',
    group: 'Setup',
  },
  { label: 'Audit', href: '/setup/audit', permission: 'Audit.Read', group: 'Setup' },
  {
    label: 'Pipeline',
    href: '/setup/pipeline',
    permission: 'Assets.Read',
    group: 'Setup',
    devOnly: true,
  },
];

export function canSeeRoute(grants: PermissionGrant[] | null, route: Route): boolean {
  if (typeof route.permission === 'object') {
    return hasAnyPermissionUnder(grants, route.permission.prefix);
  }
  return hasPermission(grants, route.permission);
}

// Server-driven filter. Returns the route map grouped by nav group, containing
// only routes the caller can access. Called from +layout.server.ts so the page
// data sent to the browser omits hidden routes.
export function buildFilteredRouteMap(
  grants: PermissionGrant[] | null,
  opts: { isDev: boolean },
): Map<string, Route[]> {
  const map = new Map<string, Route[]>();
  map.set('top', []);

  for (const route of ROUTES) {
    if (route.devOnly && !opts.isDev) continue;
    if (!canSeeRoute(grants, route)) continue;
    const group = route.group ?? 'top';
    const bucket = map.get(group) ?? [];
    bucket.push(route);
    map.set(group, bucket);
  }

  return map;
}

// Preserved for legacy callers (client-side buildRouteMap without filter). Do
// not add new callers — prefer buildFilteredRouteMap from a server load.
export function buildRouteMap(): Map<string, Route[]> {
  const map = new Map<string, Route[]>();
  map.set('top', []);
  for (const route of ROUTES) {
    const group = route.group ?? 'top';
    const bucket = map.get(group) ?? [];
    bucket.push(route);
    map.set(group, bucket);
  }
  return map;
}

export function getRoutePermission(pathname: string): RoutePermission | null {
  for (const route of ROUTES) {
    if (pathname === route.href || pathname.startsWith(route.href + '/')) {
      return route.permission;
    }
  }
  return null;
}
