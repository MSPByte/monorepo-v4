export type CalloutVariant = 'blue' | 'green' | 'yellow' | 'red' | 'purple' | 'orange';
export type OverrideType = 'addendum' | 'replacement' | 'note';

export interface WikiContextItem {
  id: string;
  parentId: string | null;
  name: string;
}

export function getContextPath<T extends WikiContextItem>(contextId: string, allContexts: T[]): T[] {
  const path: T[] = [];
  let current = allContexts.find((c) => c.id === contextId);
  while (current) {
    path.unshift(current);
    const parent = current.parentId
      ? allContexts.find((c) => c.id === current!.parentId)
      : undefined;
    current = parent;
  }
  return path;
}

export function getContextChildren<T extends WikiContextItem>(
  parentId: string | null,
  allContexts: T[]
): T[] {
  return allContexts.filter((c) => c.parentId === parentId);
}

export function getAllDescendantIds<T extends WikiContextItem>(contextId: string, allContexts: T[]): string[] {
  const result: string[] = [contextId];
  const children = getContextChildren(contextId, allContexts);
  for (const child of children) {
    result.push(...getAllDescendantIds(child.id, allContexts));
  }
  return result;
}
