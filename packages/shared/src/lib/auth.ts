export const RESOURCES = ['Sites', 'Integrations', 'Users', 'Assets'] as const;
export const ACTIONS = ['Read', 'Write', 'Delete'] as const;

type ResourcePermission = `${(typeof RESOURCES)[number]}.${(typeof ACTIONS)[number]}`;
type GlobalPermission = 'Global.Admin';
type Attributes = Record<string, boolean> | null;

export type Permission = GlobalPermission | ResourcePermission;

export const ROLE_LEVELS = [
  { value: 1, label: 'Auditor' },
  { value: 2, label: 'Helpdesk' },
  { value: 3, label: 'Support' },
  { value: 4, label: 'Administrator' },
  { value: 5, label: 'Global Administrator' }
];

export function hasPermission(attributes: Attributes, permission: Permission): boolean {
  if (!attributes) return false;
  if (attributes['Global.Admin'] === true) return true;
  if (attributes[permission] === true) return true;
  if (permission.endsWith('.Read')) {
    const writePerm = permission.replace('.Read', '.Write');
    if (attributes[writePerm] === true) return true;
    const deletePerm = permission.replace('.Read', '.Delete');
    if (attributes[deletePerm] === true) return true;
  }
  return false;
}

export function hasAnyPermission(attributes: Attributes, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(attributes, p));
}

export function canActOnLevel(
  myLevel: number | null | undefined,
  targetLevel: number | null | undefined
): boolean {
  if (myLevel == null || targetLevel == null) return false;
  return myLevel >= targetLevel;
}
