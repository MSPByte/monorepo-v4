import { describe, expect, test } from 'bun:test';
import {
  hasPermission,
  hasAnyPermission,
  hasAnyPermissionUnder,
  canActOnLevel,
  SYSTEM_ROLES,
  type PermissionGrant
} from './auth.js';

const allScope: PermissionGrant['scope'] = { kind: 'all' };
const grantsOf = (...permissions: string[]): PermissionGrant[] => [
  { permissions, scope: allScope }
];

describe('hasPermission — grant list', () => {
  test('exact match', () => {
    expect(hasPermission(grantsOf('Sites.Read'), 'Sites.Read')).toBe(true);
  });

  test('exact miss', () => {
    expect(hasPermission(grantsOf('Sites.Read'), 'Assets.Read')).toBe(false);
  });

  test('Write implies Read on same resource', () => {
    expect(hasPermission(grantsOf('Sites.Write'), 'Sites.Read')).toBe(true);
  });

  test('Delete implies Read on same resource', () => {
    expect(hasPermission(grantsOf('Sites.Delete'), 'Sites.Read')).toBe(true);
  });

  test('Delete implies Write on same resource', () => {
    expect(hasPermission(grantsOf('Sites.Delete'), 'Sites.Write')).toBe(true);
  });

  test('Read does NOT imply Write', () => {
    expect(hasPermission(grantsOf('Sites.Read'), 'Sites.Write')).toBe(false);
  });

  test('Write does NOT imply Delete', () => {
    expect(hasPermission(grantsOf('Sites.Write'), 'Sites.Delete')).toBe(false);
  });

  test('implication does not cross resources', () => {
    expect(hasPermission(grantsOf('Sites.Delete'), 'Assets.Read')).toBe(false);
  });

  test('wildcard grant `*` satisfies anything', () => {
    expect(hasPermission(grantsOf('*'), 'Sites.Read')).toBe(true);
    expect(hasPermission(grantsOf('*'), 'Vendors.Write')).toBe(true);
    expect(hasPermission(grantsOf('*'), 'Global.Admin')).toBe(true);
  });

  test('Global.Admin grant satisfies anything', () => {
    expect(hasPermission(grantsOf('Global.Admin'), 'Sites.Read')).toBe(true);
    expect(hasPermission(grantsOf('Global.Admin'), 'Global.Admin')).toBe(true);
  });

  test('subtree wildcard grant satisfies descendants', () => {
    // Vendors is a leaf today, but the evaluator must handle sub-tree grants
    // for Phase 2 (Vendors.M365.Identities.*). Use hypothetical paths.
    expect(hasPermission(grantsOf('Vendors.M365.*'), 'Vendors.M365.Identities.Read')).toBe(true);
    expect(hasPermission(grantsOf('Vendors.M365.*'), 'Vendors.M365.Read')).toBe(true);
  });

  test('subtree wildcard does not match sibling', () => {
    expect(hasPermission(grantsOf('Vendors.M365.*'), 'Vendors.Cove.Read')).toBe(false);
  });

  test('parent-path grant with action covers descendant Read', () => {
    // Vendors.Write should satisfy Vendors.M365.Identities.Read via prefix walk.
    expect(hasPermission(grantsOf('Vendors.Write'), 'Vendors.M365.Identities.Read')).toBe(true);
  });

  test('parent-path grant with action covers descendant Write via Delete', () => {
    expect(hasPermission(grantsOf('Vendors.Delete'), 'Vendors.M365.Identities.Write')).toBe(true);
  });

  test('parent-path Write does NOT cover descendant Delete', () => {
    expect(hasPermission(grantsOf('Vendors.Write'), 'Vendors.M365.Identities.Delete')).toBe(false);
  });

  test('empty grant list', () => {
    expect(hasPermission([], 'Sites.Read')).toBe(false);
  });

  test('multiple grants — union of permissions', () => {
    const grants: PermissionGrant[] = [
      { permissions: ['Sites.Read'], scope: { kind: 'sites', ids: ['a'] } },
      { permissions: ['Assets.Write'], scope: { kind: 'all' } }
    ];
    expect(hasPermission(grants, 'Sites.Read')).toBe(true);
    expect(hasPermission(grants, 'Assets.Read')).toBe(true);
    expect(hasPermission(grants, 'Assets.Write')).toBe(true);
    expect(hasPermission(grants, 'People.Read')).toBe(false);
  });
});

describe('hasPermission — legacy attribute bag', () => {
  test('null attributes → false', () => {
    expect(hasPermission(null, 'Sites.Read')).toBe(false);
  });

  test('empty object → false', () => {
    expect(hasPermission({}, 'Sites.Read')).toBe(false);
  });

  test('exact key true', () => {
    expect(hasPermission({ 'Sites.Read': true }, 'Sites.Read')).toBe(true);
  });

  test('exact key false', () => {
    expect(hasPermission({ 'Sites.Read': false }, 'Sites.Read')).toBe(false);
  });

  test('Write key satisfies Read', () => {
    expect(hasPermission({ 'Sites.Write': true }, 'Sites.Read')).toBe(true);
  });

  test('Delete key satisfies Read', () => {
    expect(hasPermission({ 'Sites.Delete': true }, 'Sites.Read')).toBe(true);
  });

  test('Delete key satisfies Write (added implication)', () => {
    expect(hasPermission({ 'Sites.Delete': true }, 'Sites.Write')).toBe(true);
  });

  test('Global.Admin key satisfies anything', () => {
    expect(hasPermission({ 'Global.Admin': true }, 'Sites.Read')).toBe(true);
    expect(hasPermission({ 'Global.Admin': true }, 'Assets.Delete')).toBe(true);
  });

  test('Owner-seed `*: true` satisfies anything (bug fix)', () => {
    expect(hasPermission({ '*': true }, 'Sites.Read')).toBe(true);
    expect(hasPermission({ '*': true }, 'Assets.Delete')).toBe(true);
    expect(hasPermission({ '*': true }, 'Global.Admin')).toBe(true);
  });
});

describe('hasAnyPermission', () => {
  test('true if any listed permission is satisfied', () => {
    expect(hasAnyPermission(grantsOf('Sites.Read'), ['Sites.Read', 'Assets.Read'])).toBe(true);
    expect(hasAnyPermission(grantsOf('Sites.Read'), ['Assets.Read'])).toBe(false);
  });
});

describe('hasAnyPermissionUnder — prefix probing for nav', () => {
  test('exact prefix under grant', () => {
    expect(hasAnyPermissionUnder(grantsOf('Vendors.Read'), 'Vendors')).toBe(true);
  });

  test('deep grant under prefix', () => {
    expect(hasAnyPermissionUnder(grantsOf('Vendors.M365.Identities.Read'), 'Vendors')).toBe(true);
    expect(hasAnyPermissionUnder(grantsOf('Vendors.M365.Identities.Read'), 'Vendors.M365')).toBe(true);
  });

  test('grant outside prefix', () => {
    expect(hasAnyPermissionUnder(grantsOf('Sites.Read'), 'Vendors')).toBe(false);
  });

  test('wildcard grant above prefix', () => {
    expect(hasAnyPermissionUnder(grantsOf('*'), 'Vendors')).toBe(true);
    expect(hasAnyPermissionUnder(grantsOf('Vendors.*'), 'Vendors.M365')).toBe(true);
  });

  test('legacy bag with prefix', () => {
    expect(hasAnyPermissionUnder({ 'Vendors.Read': true }, 'Vendors')).toBe(true);
    expect(hasAnyPermissionUnder({ 'Sites.Read': true }, 'Vendors')).toBe(false);
    expect(hasAnyPermissionUnder({ '*': true }, 'Vendors')).toBe(true);
    expect(hasAnyPermissionUnder({ 'Global.Admin': true }, 'Vendors')).toBe(true);
  });

  test('null input', () => {
    expect(hasAnyPermissionUnder(null, 'Vendors')).toBe(false);
  });
});

describe('canActOnLevel', () => {
  test('equal levels allowed', () => {
    expect(canActOnLevel(3, 3)).toBe(true);
  });

  test('higher level acts on lower', () => {
    expect(canActOnLevel(5, 3)).toBe(true);
  });

  test('lower level blocked', () => {
    expect(canActOnLevel(3, 5)).toBe(false);
  });

  test('null levels blocked', () => {
    expect(canActOnLevel(null, 3)).toBe(false);
    expect(canActOnLevel(3, null)).toBe(false);
    expect(canActOnLevel(undefined, undefined)).toBe(false);
  });
});

describe('SYSTEM_ROLES catalog', () => {
  test('exactly five roles', () => {
    expect(SYSTEM_ROLES.length).toBe(5);
  });

  test('level 5 Global Administrator has wildcard', () => {
    const globalAdmin = SYSTEM_ROLES.find((r) => r.level === 5);
    expect(globalAdmin?.name).toBe('Global Administrator');
    expect(globalAdmin?.permissions).toEqual(['*']);
  });

  test('level 4 Administrator has wildcard', () => {
    const admin = SYSTEM_ROLES.find((r) => r.level === 4);
    expect(admin?.name).toBe('Administrator');
    expect(admin?.permissions).toEqual(['*']);
  });

  test('Support has Delete on all 9 operational resources, none on config', () => {
    const support = SYSTEM_ROLES.find((r) => r.name === 'Support')!;
    const grants = grantsOf(...support.permissions);
    // Operational resources — all Delete-capable.
    for (const res of [
      'Sites',
      'Assets',
      'People',
      'Wiki',
      'Vendors',
      'Policies',
      'Frameworks',
      'Billing',
      'Findings'
    ]) {
      expect(hasPermission(grants, `${res}.Delete` as never)).toBe(true);
    }
    // Config surface — locked out.
    for (const res of ['Users', 'Roles', 'Integrations', 'Audit']) {
      expect(hasPermission(grants, `${res}.Read` as never)).toBe(false);
    }
  });

  test('Helpdesk: read across ops, write on Sites and Wiki only', () => {
    const helpdesk = SYSTEM_ROLES.find((r) => r.name === 'Helpdesk')!;
    const grants = grantsOf(...helpdesk.permissions);
    // Read everywhere operational.
    for (const res of [
      'Sites',
      'Assets',
      'People',
      'Wiki',
      'Vendors',
      'Policies',
      'Frameworks',
      'Billing',
      'Findings'
    ]) {
      expect(hasPermission(grants, `${res}.Read` as never)).toBe(true);
    }
    // Write only on Sites and Wiki.
    expect(hasPermission(grants, 'Sites.Write')).toBe(true);
    expect(hasPermission(grants, 'Wiki.Write')).toBe(true);
    expect(hasPermission(grants, 'Assets.Write')).toBe(false);
    expect(hasPermission(grants, 'Vendors.Write')).toBe(false);
    // No delete.
    expect(hasPermission(grants, 'Sites.Delete')).toBe(false);
    // No config surface.
    expect(hasPermission(grants, 'Users.Read')).toBe(false);
  });

  test('Auditor: read-only across ops, nothing else', () => {
    const auditor = SYSTEM_ROLES.find((r) => r.name === 'Auditor')!;
    const grants = grantsOf(...auditor.permissions);
    for (const res of [
      'Sites',
      'Assets',
      'People',
      'Wiki',
      'Vendors',
      'Policies',
      'Frameworks',
      'Billing',
      'Findings'
    ]) {
      expect(hasPermission(grants, `${res}.Read` as never)).toBe(true);
      expect(hasPermission(grants, `${res}.Write` as never)).toBe(false);
      expect(hasPermission(grants, `${res}.Delete` as never)).toBe(false);
    }
    expect(hasPermission(grants, 'Users.Read')).toBe(false);
    expect(hasPermission(grants, 'Audit.Read')).toBe(false);
  });

  test('all system roles marked isSystem', () => {
    for (const r of SYSTEM_ROLES) {
      expect(r.isSystem).toBe(true);
    }
  });
});
