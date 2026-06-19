import { ALERT_DEFINITIONS, hydrateMessageTemplate } from '@mspbyte/shared';

export type AlertDisplaySource = {
  definitionId?: string | null;
  entityRef?: string | null;
  entityId?: string | null;
  entityType?: string | null;
  message?: string | null;
  metadata?: unknown;
};

export function alertMetadata(metadata: unknown): Record<string, unknown> | undefined {
  if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) return undefined;
  return metadata as Record<string, unknown>;
}

export function alertDefinition(alert: AlertDisplaySource) {
  return alert.definitionId ? ALERT_DEFINITIONS[alert.definitionId] : undefined;
}

export function alertTitle(alert: AlertDisplaySource): string {
  return alertDefinition(alert)?.name ?? alert.definitionId ?? 'Alert';
}

function metadataString(metadata: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = metadata?.[key];
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function alertEntityLabel(alert: AlertDisplaySource): string {
  const metadata = alertMetadata(alert.metadata);

  if (alert.definitionId?.startsWith('microsoft-365.licenses.')) {
    return (
      metadataString(metadata, 'friendlyName') ??
      metadataString(metadata, 'skuName') ??
      alert.entityRef ??
      alert.entityId ??
      'Unknown license'
    );
  }

  return (
    metadataString(metadata, 'endpointName') ??
    metadataString(metadata, 'mailboxUpn') ??
    metadataString(metadata, 'email') ??
    metadataString(metadata, 'userPrincipalName') ??
    metadataString(metadata, 'hostname') ??
    alert.entityRef ??
    alert.entityId ??
    'Unknown entity'
  );
}

export function alertEntityKey(alert: AlertDisplaySource): string {
  const ref = alert.entityRef ?? alert.entityId ?? 'unknown';
  const label = alertEntityLabel(alert);
  // Inbox rules use "user@example.com::RuleName" — group by user part when metadata is unavailable.
  if (label === ref && ref.includes('::')) return ref.split('::')[0];
  return label;
}

export function hydratedAlertMessage(alert: AlertDisplaySource): string {
  const def = alertDefinition(alert);
  const metadata = alertMetadata(alert.metadata);

  if (def?.messageTemplate && metadata) {
    return hydrateMessageTemplate(def.messageTemplate, metadata);
  }

  return alert.message ?? def?.description ?? '';
}

export function formatAlertValue(value: unknown): string {
  if (value == null) return '—';
  if (Array.isArray(value)) return value.map(formatAlertValue).join(', ');
  if (value instanceof Date) return value.toLocaleString();
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

export function metadataLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

const DETAIL_PRIORITY = [
  'mailboxUpn',
  'ruleName',
  'forwardTo',
  'redirectTo',
  'skuName',
  'unusedUnits',
  'totalUnits',
  'warningUnits',
  'endpointName',
  'errors',
  'lastSuccessAt',
  'email',
  'reasons',
];

export function alertMetadataEntries(alert: AlertDisplaySource): Array<[string, unknown]> {
  const metadata = alertMetadata(alert.metadata);
  if (!metadata) return [];

  const entries = Object.entries(metadata).filter(([, value]) => value != null && value !== '');
  return entries.sort(([a], [b]) => {
    const aIdx = DETAIL_PRIORITY.indexOf(a);
    const bIdx = DETAIL_PRIORITY.indexOf(b);
    if (aIdx !== -1 || bIdx !== -1) {
      return (aIdx === -1 ? Number.MAX_SAFE_INTEGER : aIdx) -
        (bIdx === -1 ? Number.MAX_SAFE_INTEGER : bIdx);
    }
    return a.localeCompare(b);
  });
}

export function alertSearchText(alert: AlertDisplaySource): string {
  return [
    alertTitle(alert),
    alertEntityLabel(alert),
    hydratedAlertMessage(alert),
    alert.entityType,
    ...alertMetadataEntries(alert).flatMap(([key, value]) => [key, formatAlertValue(value)]),
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}
