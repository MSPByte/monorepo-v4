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
  /** Child routes rendered as a popover from the parent nav pill.
   * When present, the parent's `href` acts as the group's landing page. */
  children?: Route[];
};

// Permission fields accept either a concrete Permission (`Users.Read`) or a
// tree prefix (`{ prefix: 'Vendors' }`) so a group can render when the caller
// has *any* grant under the subtree. Prefixes are used by nav groups whose
// children ship in Phase 2 (per-integration entries under Vendors).
const ROUTES: Route[] = [
  { label: 'Overview', href: '/home', permission: 'Assets.Read' },
  // Findings is the queue technicians live in — kept as its own top-level tab
  // rather than buried under a group.
  { label: 'Findings', href: '/findings', permission: 'Findings.Read' },
  {
    label: 'Automation',
    href: '/automation/packages',
    permission: 'Packages.Read',
    children: [
      { label: 'Packages', href: '/automation/packages', permission: 'Packages.Read' },
      { label: 'Package Runs', href: '/automation/runs', permission: 'Packages.Read' },
      { label: 'Schedules', href: '/automation/schedules', permission: 'Packages.Read' },
      { label: 'Fact Rules', href: '/automation/fact-rules', permission: 'Policies.Read' },
    ],
  },
  {
    label: 'Inventory',
    href: '/sites',
    permission: 'Sites.Read',
    children: [
      { label: 'Sites', href: '/sites', permission: 'Sites.Read' },
      { label: 'Groups', href: '/groups', permission: 'Sites.Read' },
      { label: 'Assets', href: '/assets', permission: 'Assets.Read' },
      // { label: 'People', href: '/people', permission: 'People.Read' },
    ],
  },
  {
    label: 'Compliance',
    href: '/policies',
    permission: 'Policies.Read',
    children: [
      { label: 'Policies', href: '/policies', permission: 'Policies.Read' },
      { label: 'Frameworks', href: '/frameworks', permission: 'Frameworks.Read' },
    ],
  },
  {
    label: 'Operations',
    href: '/billing',
    permission: { prefix: 'Billing' },
    children: [
      { label: 'Billing', href: '/billing', permission: 'Billing.Read' },
      { label: 'Wiki', href: '/wiki', permission: 'Wiki.Read' },
    ],
  },
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
    href: '/dev/pipeline',
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

// Filter children the caller can't see; return null if nothing visible remains.
function filterRoute(
  grants: PermissionGrant[] | null,
  route: Route,
  opts: { isDev: boolean }
): Route | null {
  if (route.devOnly && !opts.isDev) return null;
  if (route.children?.length) {
    const visibleChildren = route.children
      .map((child) => filterRoute(grants, child, opts))
      .filter((c): c is Route => c !== null);
    if (visibleChildren.length === 0) return null;
    // Parent visibility follows its children — no need to also grant the parent's
    // permission directly. Landing href defaults to the first visible child if
    // the parent's own href isn't accessible.
    const parentAccessible = canSeeRoute(grants, route);
    return {
      ...route,
      href: parentAccessible ? route.href : visibleChildren[0].href,
      children: visibleChildren,
    };
  }
  if (!canSeeRoute(grants, route)) return null;
  return route;
}

// Server-driven filter. Returns the route map grouped by nav group, containing
// only routes the caller can access. Called from +layout.server.ts so the page
// data sent to the browser omits hidden routes.
export function buildFilteredRouteMap(
  grants: PermissionGrant[] | null,
  opts: { isDev: boolean }
): Map<string, Route[]> {
  const map = new Map<string, Route[]>();
  map.set('top', []);

  for (const route of ROUTES) {
    const filtered = filterRoute(grants, route, opts);
    if (!filtered) continue;
    const group = filtered.group ?? 'top';
    const bucket = map.get(group) ?? [];
    bucket.push(filtered);
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

/** Flatten a route tree for use in the command palette / permission lookups. */
export function flattenRoutes(routes: Route[]): Route[] {
  const out: Route[] = [];
  for (const r of routes) {
    if (r.children?.length) {
      out.push(...flattenRoutes(r.children));
    } else {
      out.push(r);
    }
  }
  return out;
}

export function getRoutePermission(pathname: string): RoutePermission | null {
  const flat = flattenRoutes(ROUTES);
  for (const route of flat) {
    if (pathname === route.href || pathname.startsWith(route.href + '/')) {
      return route.permission;
    }
  }
  return null;
}
