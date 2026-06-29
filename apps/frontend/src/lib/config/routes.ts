import type { Permission } from '@mspbyte/shared';

type Route = {
  label: string;
  href: string;
  permission: Permission;
  group?: string;
  devOnly?: boolean;
};

const ROUTES: Route[] = [
  {
    label: 'Overview',
    href: '/home',
    permission: 'Assets.Read',
  },
  {
    label: 'Findings',
    href: '/findings',
    permission: 'Assets.Read',
  },
  {
    label: 'Sites',
    href: '/sites',
    permission: 'Sites.Read',
  },
  {
    label: 'Assets',
    href: '/assets',
    permission: 'Assets.Read',
  },
  {
    label: 'People',
    href: '/people',
    permission: 'Assets.Read',
  },
  {
    label: 'Policies',
    href: '/policies',
    permission: 'Assets.Read',
  },
  {
    label: 'Frameworks',
    href: '/frameworks',
    permission: 'Assets.Read',
  },
  {
    label: 'Billing',
    href: '/billing',
    permission: 'Assets.Read',
  },
  {
    label: 'Wiki',
    href: '/wiki',
    devOnly: true,
    permission: 'Assets.Read',
  },
  {
    label: 'Users',
    href: '/setup/users',
    permission: 'Users.Read',
    group: 'Setup',
  },
  {
    label: 'Roles',
    href: '/setup/roles',
    permission: 'Users.Read',
    group: 'Setup',
  },
  {
    label: 'Sites',
    href: '/setup/sites',
    devOnly: true,
    permission: 'Sites.Write',
    group: 'Setup',
  },
  {
    label: 'Integrations',
    href: '/setup/integrations',
    permission: 'Integrations.Read',
    group: 'Setup',
  },
  {
    label: 'Audit',
    href: '/setup/audit',
    permission: 'Global.Admin',
    group: 'Setup',
  },
  {
    label: 'Pipeline',
    href: '/setup/pipeline',
    permission: 'Assets.Read',
    group: 'Setup',
    devOnly: true,
  },
];

export function buildRouteMap(): Map<string, Route[]> {
  const routeMap = new Map<string, Route[]>();
  routeMap.set('top', []);

  for (const route of ROUTES) {
    if (!route.group) {
      routeMap.set('top', [...routeMap.get('top')!, route]);
      continue;
    }

    if (routeMap.has(route.group)) {
      const existing = routeMap.get(route.group)!;
      routeMap.set(route.group, [...existing, route]);
    } else {
      routeMap.set(route.group, [route]);
    }
  }

  return routeMap;
}

export function getRoutePermission(pathname: string): Permission | null {
  for (const route of ROUTES) {
    if (pathname === route.href || pathname.startsWith(route.href + '/')) {
      return route.permission;
    }
  }
  return null;
}
