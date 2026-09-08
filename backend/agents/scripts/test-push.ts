#!/usr/bin/env bun
/**
 * Push pipeline smoke test.
 *
 * Usage:
 *   # Dev mode (DEV_TRIGGER_ENABLED=true on the server, no secret needed):
 *   bun run scripts/test-push.ts --org <orgId> --kind bundle_updated
 *   bun run scripts/test-push.ts --org <orgId> --kind ticket_note_added --ticket-id 123
 *
 *   # Production code path (HMAC-signed, same as HaloPSA webhook):
 *   AGENTS_INTERNAL_SECRET=xxx bun run scripts/test-push.ts \
 *     --org <orgId> --kind ticket_note_added --ticket-id 456 --use-webhook-secret
 *
 *   # List connected devices first to get an orgId:
 *   AGENTS_INTERNAL_SECRET=xxx bun run scripts/test-push.ts --list-connections
 *
 * Options:
 *   --base-url   Agents backend URL (default: http://localhost:3001)
 *   --org        Org ID to push to
 *   --kind       bundle_updated | ticket_note_added | ticket_status_changed
 *   --ticket-id  Required for ticket_* kinds
 *   --status     Required for ticket_status_changed
 *   --etag       Optional etag for bundle_updated
 *   --use-webhook-secret  Use HMAC-derived org secret and hit the HaloPSA webhook route
 *   --list-connections    List currently connected WS devices and exit
 */

import crypto from 'crypto';

const args = process.argv.slice(2);

function flag(name: string): boolean {
  return args.includes(name);
}

function arg(name: string): string | undefined {
  const i = args.indexOf(name);
  return i !== -1 ? args[i + 1] : undefined;
}

const BASE_URL = (arg('--base-url') ?? 'http://localhost:3003').replace(/\/$/, '');
const MASTER_SECRET = process.env.AGENTS_INTERNAL_SECRET;
const ORG_ID = arg('--org');
const KIND = arg('--kind') ?? 'bundle_updated';
const TICKET_ID = arg('--ticket-id');
const STATUS = arg('--status');
const ETAG = arg('--etag');
const USE_WEBHOOK_SECRET = flag('--use-webhook-secret');
const LIST_CONNECTIONS = flag('--list-connections');

function deriveOrgSecret(orgId: string): string {
  if (!MASTER_SECRET) throw new Error('AGENTS_INTERNAL_SECRET not set');
  return crypto.createHmac('sha256', MASTER_SECRET).update(orgId).digest('hex').slice(0, 32);
}

async function listConnections() {
  if (!MASTER_SECRET) {
    console.error('AGENTS_INTERNAL_SECRET required to list connections');
    process.exit(1);
  }
  const res = await fetch(`${BASE_URL}/internal/connections`, {
    headers: { 'X-Internal-Secret': MASTER_SECRET }
  });
  const text = await res.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    console.error(`✗ HTTP ${res.status} — non-JSON response:`);
    console.error(text.slice(0, 800));
    process.exit(1);
  }
  if (!res.ok) {
    console.error('Error:', res.status, body);
    process.exit(1);
  }
  const { count, connections } = body.data;
  if (count === 0) {
    console.log('No devices connected.');
    return;
  }
  console.log(`${count} connected device(s):\n`);
  for (const c of connections) {
    const state = c.readyState === 1 ? 'OPEN' : `state=${c.readyState}`;
    console.log(`  ${c.deviceId}  org=${c.orgId}  ${state}`);
  }
}

async function triggerEvent() {
  if (!ORG_ID) {
    console.error('--org <orgId> is required');
    process.exit(1);
  }

  let url: string;
  let headers: Record<string, string> = { 'Content-Type': 'application/json' };
  let body: Record<string, unknown>;

  if (USE_WEBHOOK_SECRET) {
    // Exercise the same code path as HaloPSA: per-org HMAC secret, webhook route.
    const orgSecret = deriveOrgSecret(ORG_ID);
    url = `${BASE_URL}/internal/webhook/halopsa/${ORG_ID}/ticket-event`;
    headers['X-Internal-Secret'] = orgSecret;
    body = {
      ticket_id: TICKET_ID ?? '0',
      ...(KIND === 'ticket_status_changed'
        ? { kind: 'ticket_status_changed', status_name: STATUS ?? 'Waiting' }
        : { kind: 'ticket_note_added' })
    };
    console.log(`Firing via webhook route (HMAC-signed):`);
  } else {
    // Dev mode: hit the unauthenticated trigger endpoint (DEV_TRIGGER_ENABLED=true required).
    url = `${BASE_URL}/internal/dev/trigger`;
    body = {
      org_id: ORG_ID,
      kind: KIND,
      ...(TICKET_ID ? { ticket_id: TICKET_ID } : {}),
      ...(STATUS ? { status_name: STATUS } : {}),
      ...(ETAG ? { etag: ETAG } : {})
    };
    console.log(`Firing via dev trigger (no auth):`);
  }

  console.log(`  URL:  ${url}`);
  console.log(`  Body: ${JSON.stringify(body)}\n`);

  const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body) });
  const text = await res.text();

  let result: any;
  try {
    result = JSON.parse(text);
  } catch {
    console.error(`✗ HTTP ${res.status} — non-JSON response:`);
    console.error(text.slice(0, 800));
    process.exit(1);
  }

  if (res.ok) {
    const sent = result.data?.sent ?? result.data?.count ?? '?';
    console.log(`✓ Sent to ${sent} connected device(s).`);
    if (sent === 0) {
      console.log('  (0 devices — is agent-core running and connected?)');
    }
  } else {
    console.error(`✗ HTTP ${res.status}:`, result);
    process.exit(1);
  }
}

if (LIST_CONNECTIONS) {
  await listConnections();
} else {
  await triggerEvent();
}
