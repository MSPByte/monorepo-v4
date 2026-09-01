// Turn a technical key like "userPrincipalName" or "force_change_at_next_signin"
// into a human-facing sentence-case label: "User principal name",
// "Force change at next sign in". Used as a fallback when a capability doesn't
// declare a `label` in its inputMeta.
export function prettifyKey(key: string): string {
  if (!key) return '';
  // snake_case → space, kebab-case → space, then split camelCase.
  const withSpaces = key
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!withSpaces) return key;
  const lower = withSpaces.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Prefer the explicit label from capability metadata, fall back to the key.
export function fieldLabel(key: string, label?: string | null): string {
  if (label && label.trim().length > 0) return label;
  return prettifyKey(key);
}

const SEVERITY_LABELS: Record<number, string> = { 4: 'CRITICAL', 3: 'HIGH', 2: 'MEDIUM', 1: 'LOW' };

export function severityLabel(severity: number): string {
  return SEVERITY_LABELS[severity] ?? 'LOW';
}
