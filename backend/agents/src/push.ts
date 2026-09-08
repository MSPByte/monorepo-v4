import type { WebSocket } from 'ws';

export type PushEventKind =
  | { kind: 'bundle_updated'; payload: { etag?: string } }
  | { kind: 'ticket_note_added'; payload: { ticket_id: string } }
  | { kind: 'ticket_status_changed'; payload: { ticket_id: string; status_name: string } };

interface ConnectionEntry {
  ws: WebSocket;
  orgId: string;
}

// In-process registry: deviceId → live connection.
// For multi-node deployments this should move to Redis pub/sub.
const connections = new Map<string, ConnectionEntry>();

export function registerDevice(deviceId: string, orgId: string, ws: WebSocket): void {
  connections.set(deviceId, { ws, orgId });
}

export function unregisterDevice(deviceId: string): void {
  connections.delete(deviceId);
}

export function pushToDevice(deviceId: string, event: PushEventKind): boolean {
  const entry = connections.get(deviceId);
  if (!entry || entry.ws.readyState !== entry.ws.OPEN) return false;
  entry.ws.send(JSON.stringify(event));
  return true;
}

export function pushToOrg(orgId: string, event: PushEventKind): number {
  let sent = 0;
  for (const [id, entry] of connections) {
    if (entry.orgId === orgId && entry.ws.readyState === entry.ws.OPEN) {
      entry.ws.send(JSON.stringify(event));
      sent++;
    }
  }
  return sent;
}

export function connectedDeviceIds(orgId: string): string[] {
  return [...connections.entries()]
    .filter(([, e]) => e.orgId === orgId)
    .map(([id]) => id);
}

export function listConnections(): Array<{ deviceId: string; orgId: string; readyState: number }> {
  return [...connections.entries()].map(([deviceId, entry]) => ({
    deviceId,
    orgId: entry.orgId,
    readyState: entry.ws.readyState,
  }));
}
