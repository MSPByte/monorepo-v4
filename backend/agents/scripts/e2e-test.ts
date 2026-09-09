#!/usr/bin/env bun
/**
 * MSPAgent E2E test suite.
 *
 * Runs HTTP-level checks against a live agents server. No DB access required —
 * everything goes through the public API. Safe to run against staging or a local
 * dev server (never run --block 2 against prod without a dedicated test site).
 *
 * Usage:
 *   bun run scripts/e2e-test.ts [options]
 *
 * Options:
 *   --base-url <url>      Agents server (default: http://localhost:3003)
 *   --org <uuid>          Org ID (required for most blocks)
 *   --site <uuid>         Site ID (required for --block 13 v1 tests)
 *   --token <string>      Enrollment token (required for --block 2)
 *   --device-id <uuid>    Skip enrollment; use an existing device ID
 *   --ticket-id <id>      Skip form submit; use an existing HaloPSA ticket ID
 *   --form-id <uuid>      Skip bundle fetch; use a known form ID for submit test
 *   --block <n>           Run only this block (1–9, 13). Omit to run all.
 *   --no-v1               Skip block 13 (v1.0 backward compat)
 *   --webhook             Include block 9 (HaloPSA webhook) — needs AGENTS_INTERNAL_SECRET
 *   --save-state          Persist device-id / ticket-id to .e2e-state.json for next run
 *   --load-state          Load device-id / ticket-id from .e2e-state.json
 *   --list-connections    List connected WS devices and exit
 *
 * Environment:
 *   AGENTS_INTERNAL_SECRET  Required for --webhook and --list-connections
 *
 * Examples:
 *   # Full run on local dev server (fresh enrollment):
 *   bun run scripts/e2e-test.ts --org <id> --site <id> --token <tok> --save-state
 *
 *   # Re-run against existing enrolled device (saved from a prior run):
 *   bun run scripts/e2e-test.ts --org <id> --load-state --no-v1
 *
 *   # API-only smoke test of a specific block:
 *   bun run scripts/e2e-test.ts --org <id> --load-state --block 7
 *
 *   # Full run including webhook tests:
 *   AGENTS_INTERNAL_SECRET=xxx bun run scripts/e2e-test.ts \
 *     --org <id> --site <id> --token <tok> --save-state --webhook
 */

import crypto from 'crypto';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

// ─── CLI parsing ─────────────────────────────────────────────────────────────

const argv = process.argv.slice(2);

function flag(name: string): boolean {
  return argv.includes(name);
}
function arg(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : undefined;
}

const BASE_URL  = (arg('--base-url') ?? 'http://localhost:3003').replace(/\/$/, '');
const ORG_ID    = arg('--org') ?? '';
const SITE_ID   = arg('--site') ?? '';
const TOKEN     = arg('--token') ?? '';
const BLOCK     = arg('--block') ? parseInt(arg('--block')!, 10) : null;
const SKIP_V1   = flag('--no-v1');
const WITH_WH   = flag('--webhook');
const SAVE_STATE = flag('--save-state');
const LOAD_STATE = flag('--load-state');
const LIST_CONNS = flag('--list-connections');

const MASTER_SECRET = process.env.AGENTS_INTERNAL_SECRET ?? '';

const __dir = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = resolve(__dir, '.e2e-state.json');

// ─── State (device_id / ticket_id persisted across runs) ─────────────────────

interface State {
  deviceId: string;
  ticketId: string;
  v1DeviceId: string;
}

let state: State = { deviceId: '', ticketId: '', v1DeviceId: '' };

if (LOAD_STATE && existsSync(STATE_FILE)) {
  try {
    state = JSON.parse(readFileSync(STATE_FILE, 'utf8'));
    print.info(`Loaded state: device=${state.deviceId} ticket=${state.ticketId}`);
  } catch {
    print.warn('Could not load .e2e-state.json — starting fresh');
  }
}

// CLI flags override state file
if (arg('--device-id')) state.deviceId = arg('--device-id')!;
if (arg('--ticket-id')) state.ticketId = arg('--ticket-id')!;
if (arg('--form-id'))   {} // handled inline

function saveState() {
  if (!SAVE_STATE) return;
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
  print.info(`State saved to .e2e-state.json`);
}

// ─── Output helpers ───────────────────────────────────────────────────────────

const RESET  = '\x1b[0m';
const GREEN  = '\x1b[32m';
const RED    = '\x1b[31m';
const YELLOW = '\x1b[33m';
const CYAN   = '\x1b[36m';
const BOLD   = '\x1b[1m';
const DIM    = '\x1b[2m';

const print = {
  pass:   (label: string, detail = '') => console.log(`  ${GREEN}✓${RESET} ${label}${detail ? DIM + '  ' + detail + RESET : ''}`),
  fail:   (label: string, detail = '') => console.log(`  ${RED}✗${RESET} ${label}${detail ? DIM + '  ' + detail + RESET : ''}`),
  skip:   (label: string, reason = '') => console.log(`  ${YELLOW}–${RESET} ${label}${reason ? DIM + '  (' + reason + ')' + RESET : ''}`),
  info:   (msg: string) => console.log(`  ${CYAN}·${RESET} ${DIM}${msg}${RESET}`),
  warn:   (msg: string) => console.log(`  ${YELLOW}!${RESET} ${DIM}${msg}${RESET}`),
  header: (msg: string) => console.log(`\n${BOLD}${msg}${RESET}`),
};

let passed = 0;
let failed = 0;
let skipped = 0;

function ok(label: string, detail?: string) {
  passed++;
  print.pass(label, detail);
}

function fail(label: string, detail: string) {
  failed++;
  print.fail(label, detail);
}

function skip(label: string, reason?: string) {
  skipped++;
  print.skip(label, reason);
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

interface Req {
  method?: string;
  headers?: Record<string, string>;
  body?: unknown;
}

async function http(path: string, opts: Req = {}): Promise<{ status: number; body: unknown }> {
  const { method = 'GET', headers = {}, body } = opts;
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let parsed: unknown;
  const text = await res.text();
  try { parsed = JSON.parse(text); } catch { parsed = text; }
  return { status: res.status, body: parsed };
}

function deviceHeaders(orgId = ORG_ID, deviceId = state.deviceId): Record<string, string> {
  return { 'X-Device-ID': deviceId, 'X-Org-ID': orgId };
}

function deriveOrgSecret(orgId: string): string {
  if (!MASTER_SECRET) throw new Error('AGENTS_INTERNAL_SECRET not set');
  return crypto.createHmac('sha256', MASTER_SECRET).update(orgId).digest('hex').slice(0, 32);
}

// ─── Block 1: Health ──────────────────────────────────────────────────────────

async function block1() {
  print.header('Block 1 — Server health');

  const { status, body } = await http('/health');
  const b = body as Record<string, unknown>;

  if (status === 200 && b?.status === 'ok') {
    ok('GET /health → 200 ok', `version=${b.version ?? 'unknown'}`);
  } else {
    fail('GET /health → 200 ok', `got ${status} ${JSON.stringify(body)}`);
  }
}

// ─── Block 2: Enrollment ─────────────────────────────────────────────────────

async function block2() {
  print.header('Block 2 — Enrollment');

  if (!TOKEN) {
    skip('enrollment tests', '--token not provided');
    return;
  }
  if (!ORG_ID) {
    skip('enrollment tests', '--org not provided');
    return;
  }

  const machineId = `e2e-machine-${Date.now()}`;

  // 2.1 Fresh enrollment
  {
    const { status, body } = await http('/v2.0/enroll', {
      method: 'POST',
      body: {
        org_id: ORG_ID,
        enrollment_token: TOKEN,
        hostname: 'e2e-test-host',
        platform: 'linux',
        version: '0.0.1-e2e',
        machine_id: machineId,
        ip_address: '10.0.0.1',
        username: 'e2e-user',
      },
    });
    const b = body as Record<string, unknown>;
    const data = b?.data as Record<string, unknown> | undefined;
    if (status === 200 && typeof data?.device_id === 'string') {
      state.deviceId = data.device_id;
      ok('POST /v2.0/enroll (fresh)', `device_id=${state.deviceId}`);
    } else {
      fail('POST /v2.0/enroll (fresh)', `${status} ${JSON.stringify(body)}`);
      print.warn('Remaining enrollment tests will be skipped — no device_id');
      return;
    }
  }

  // 2.2 Re-enroll same machine_id — must return same device_id
  {
    const { status, body } = await http('/v2.0/enroll', {
      method: 'POST',
      body: {
        org_id: ORG_ID,
        enrollment_token: TOKEN,
        hostname: 'e2e-test-host-v2',
        platform: 'linux',
        version: '0.0.2-e2e',
        machine_id: machineId,
      },
    });
    const data = (body as Record<string, unknown>)?.data as Record<string, unknown> | undefined;
    if (status === 200 && data?.device_id === state.deviceId) {
      ok('POST /v2.0/enroll (re-enroll same machine_id)', 'same device_id returned');
    } else {
      fail('POST /v2.0/enroll (re-enroll same machine_id)', `${status} ${JSON.stringify(body)}`);
    }
  }

  // 2.3 Bad token
  {
    const { status } = await http('/v2.0/enroll', {
      method: 'POST',
      body: { org_id: ORG_ID, enrollment_token: 'invalid-token', hostname: 'x', platform: 'linux', version: '0.0.0' },
    });
    if (status === 401) {
      ok('POST /v2.0/enroll (bad token) → 401');
    } else {
      fail('POST /v2.0/enroll (bad token) → 401', `got ${status}`);
    }
  }
}

// ─── Block 3: Checkin ─────────────────────────────────────────────────────────

async function block3() {
  print.header('Block 3 — Checkin');

  if (!state.deviceId) { skip('checkin tests', 'no device_id — run block 2 first'); return; }

  // 3.1 Normal checkin
  {
    const { status } = await http('/v2.0/checkin', {
      method: 'POST',
      headers: deviceHeaders(),
      body: { version: '0.0.2-e2e', hostname: 'e2e-test-host', ip_address: '10.0.0.2', username: 'e2e-user' },
    });
    if (status === 200) ok('POST /v2.0/checkin → 200');
    else fail('POST /v2.0/checkin → 200', `got ${status}`);
  }

  // 3.2 Missing device header
  {
    const { status } = await http('/v2.0/checkin', {
      method: 'POST',
      headers: { 'X-Org-ID': ORG_ID },
      body: { version: '0.0.1' },
    });
    if (status === 401) ok('POST /v2.0/checkin (no device header) → 401');
    else fail('POST /v2.0/checkin (no device header) → 401', `got ${status}`);
  }

  // 3.3 Missing org header
  {
    const { status } = await http('/v2.0/checkin', {
      method: 'POST',
      headers: { 'X-Device-ID': state.deviceId },
      body: { version: '0.0.1' },
    });
    if (status === 401) ok('POST /v2.0/checkin (no org header) → 401');
    else fail('POST /v2.0/checkin (no org header) → 401', `got ${status}`);
  }
}

// ─── Block 4: Bundle ──────────────────────────────────────────────────────────

async function block4(): Promise<string | null> {
  print.header('Block 4 — Bundle fetch');

  if (!state.deviceId) { skip('bundle tests', 'no device_id'); return null; }

  // 4.1 Valid device
  {
    const { status, body } = await http('/v2.0/bundle', { headers: deviceHeaders() });
    const b = body as Record<string, unknown>;
    const data = b?.data as Record<string, unknown> | undefined;
    if (status === 200 && data?.branding) {
      const forms = (data.forms as unknown[]) ?? [];
      ok('GET /v2.0/bundle → 200', `forms=${forms.length} branding=${JSON.stringify(data.branding).slice(0, 60)}…`);
      const firstForm = (forms[0] as Record<string, unknown> | undefined);
      return firstForm?.id as string ?? null;
    } else {
      fail('GET /v2.0/bundle → 200', `${status} ${JSON.stringify(body).slice(0, 120)}`);
      return null;
    }
  }
}

// ─── Block 5: Submit ──────────────────────────────────────────────────────────

async function block5(formId: string | null) {
  print.header('Block 5 — Form submission (ticket create)');

  const fid = arg('--form-id') ?? formId;
  if (!fid) { skip('submit tests', 'no form-id — bundle may have no forms, or pass --form-id'); return; }
  if (!state.deviceId) { skip('submit tests', 'no device_id'); return; }

  // 5.1 Valid submission
  {
    const { status, body } = await http('/v2.0/submit', {
      method: 'POST',
      headers: deviceHeaders(),
      body: {
        form_id: fid,
        answers: {},
        os_user: { username: 'e2e-user', sid: 'uid:9999', display_name: 'E2E Test User' },
        attachments: [],
      },
    });
    const b = body as Record<string, unknown>;
    const data = b?.data as Record<string, unknown> | undefined;

    // PSA not configured → returns 200 with error field; treat as skip not fail
    if (status === 200 && typeof data?.ticket_id === 'string') {
      state.ticketId = data.ticket_id;
      ok('POST /v2.0/submit → ticket created', `ticket_id=${state.ticketId}`);
    } else if (status === 200 && (b as Record<string, unknown>)?.error) {
      skip('POST /v2.0/submit', `PSA not configured for site: ${(b as Record<string, unknown>).error}`);
    } else {
      fail('POST /v2.0/submit → ticket created', `${status} ${JSON.stringify(body).slice(0, 180)}`);
    }
  }

  // 5.2 Unknown form ID
  {
    const { status } = await http('/v2.0/submit', {
      method: 'POST',
      headers: deviceHeaders(),
      body: {
        form_id: '00000000-0000-0000-0000-000000000000',
        answers: {},
        os_user: { username: 'e2e-user', sid: null, display_name: null },
        attachments: [],
      },
    });
    if (status === 404) ok('POST /v2.0/submit (unknown form) → 404');
    else fail('POST /v2.0/submit (unknown form) → 404', `got ${status}`);
  }
}

// ─── Block 6: Tickets ─────────────────────────────────────────────────────────

async function block6() {
  print.header('Block 6 — Tickets');

  if (!state.deviceId) { skip('ticket tests', 'no device_id'); return; }

  // 6.1 List tickets
  {
    const { status, body } = await http('/v2.0/tickets', {
      headers: { ...deviceHeaders(), 'X-OS-SID': 'uid:9999' },
    });
    const b = body as Record<string, unknown>;
    if (status === 200 && Array.isArray((b?.data as unknown[]))) {
      const count = ((b.data as unknown[]) ?? []).length;
      ok('GET /v2.0/tickets → 200', `${count} ticket(s) for this device`);
    } else {
      fail('GET /v2.0/tickets → 200', `${status} ${JSON.stringify(body).slice(0, 120)}`);
    }
  }

  // 6.2 Ticket detail
  if (state.ticketId) {
    const { status, body } = await http(`/v2.0/tickets/${state.ticketId}`, {
      headers: deviceHeaders(),
    });
    const data = ((body as Record<string, unknown>)?.data) as Record<string, unknown> | undefined;
    if (status === 200 && Array.isArray(data?.actions)) {
      ok(`GET /v2.0/tickets/:id → 200`, `${data!.actions.length} action(s)`);
    } else {
      fail(`GET /v2.0/tickets/:id → 200`, `${status} ${JSON.stringify(body).slice(0, 120)}`);
    }
  } else {
    skip('GET /v2.0/tickets/:id', 'no ticket_id — run block 5 first');
  }

  // 6.3 Reply
  if (state.ticketId) {
    const { status, body } = await http(`/v2.0/tickets/${state.ticketId}/reply`, {
      method: 'POST',
      headers: deviceHeaders(),
      body: {
        note: 'E2E test reply — please ignore',
        os_user: { username: 'e2e-user' },
        attachments: [],
      },
    });
    const b = body as Record<string, unknown>;
    const data = b?.data as Record<string, unknown> | undefined;
    if (status === 200 && data?.ok === true) {
      ok('POST /v2.0/tickets/:id/reply → ok');
    } else if (status === 200 && b?.error) {
      skip('POST /v2.0/tickets/:id/reply', `PSA not configured: ${b.error}`);
    } else {
      fail('POST /v2.0/tickets/:id/reply', `${status} ${JSON.stringify(body).slice(0, 120)}`);
    }
  } else {
    skip('POST /v2.0/tickets/:id/reply', 'no ticket_id');
  }

  // 6.4 Missing device header
  {
    const { status } = await http('/v2.0/tickets', { headers: { 'X-Org-ID': ORG_ID } });
    if (status === 401) ok('GET /v2.0/tickets (no device header) → 401');
    else fail('GET /v2.0/tickets (no device header) → 401', `got ${status}`);
  }
}

// ─── Block 7: Self-update ─────────────────────────────────────────────────────

async function block7() {
  print.header('Block 7 — Self-update manifest');

  if (!state.deviceId) { skip('update tests', 'no device_id'); return; }

  // 7.1 Update manifest
  const PLATFORM_SLUGS = ['windows-x86_64', 'linux-x86_64', 'linux-aarch64', 'darwin-x86_64', 'darwin-aarch64'];
  {
    const { status, body } = await http('/v2.0/updates', { headers: deviceHeaders() });
    const data = ((body as Record<string, unknown>)?.data) as Record<string, unknown> | undefined;
    if (status === 200 && typeof data?.latest_version === 'string' && data?.platforms) {
      ok('GET /v2.0/updates → 200', `latest_version=${data.latest_version}`);
      const platforms = data.platforms as Record<string, unknown>;
      const missing = PLATFORM_SLUGS.filter((s) => !platforms[s]);
      if (missing.length === 0) ok('  all 5 platform URLs present in manifest');
      else fail('  all 5 platform URLs present in manifest', `missing: ${missing.join(', ')}`);
    } else {
      fail('GET /v2.0/updates → 200', `${status} ${JSON.stringify(body).slice(0, 120)}`);
    }
  }

  // 7.2 Unknown platform slug
  {
    const { status } = await http('/v2.0/updates/download/amiga-m68k/0.0.1', { headers: deviceHeaders() });
    if (status === 400) ok('GET /v2.0/updates/download (bad platform) → 400');
    else fail('GET /v2.0/updates/download (bad platform) → 400', `got ${status}`);
  }

  // 7.3 Probe download URLs — 200 means binary is staged, 404 means not yet
  {
    print.info('Probing binary download URLs:');
    for (const slug of PLATFORM_SLUGS) {
      const ext = slug.startsWith('windows') ? '.exe' : '';
      const { status, body } = await http(`/v2.0/updates/download/${slug}/0.0.1-e2e${ext}`, { headers: deviceHeaders() });
      const label = `  GET /v2.0/updates/download/${slug}/…`;
      if (status === 200) ok(label, 'binary present');
      else if (status === 404) skip(label, 'binary not staged (expected until release)');
      else fail(label, `unexpected ${status} ${String(body).slice(0, 80)}`);
    }
  }
}

// ─── Block 8: WebSocket push pipeline ─────────────────────────────────────────

async function block8() {
  print.header('Block 8 — WebSocket push pipeline');

  if (!state.deviceId) { skip('WS tests', 'no device_id'); return; }

  let ws: WebSocket | null = null;
  const received: unknown[] = [];
  let wsError = '';

  const wsUrl = BASE_URL.replace(/^http/, 'ws') + '/v2.0/ws';

  try {
    ws = new WebSocket(wsUrl, {
      // @ts-ignore — Bun WebSocket supports headers here
      headers: {
        'X-Device-ID': state.deviceId,
        'X-Org-ID': ORG_ID,
      },
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 5000);
      ws!.addEventListener('open', () => { clearTimeout(timeout); resolve(); });
      ws!.addEventListener('error', (e) => { clearTimeout(timeout); wsError = String(e); reject(new Error(wsError)); });
    });
    ok('WS /v2.0/ws connected');

    ws.addEventListener('message', (e) => {
      try { received.push(JSON.parse(e.data as string)); } catch { received.push(e.data); }
    });

    // Fire a dev trigger and check the WS receives it
    const triggerRes = await http('/internal/dev/trigger', {
      method: 'POST',
      body: { org_id: ORG_ID, kind: 'bundle_updated' },
    });
    if (triggerRes.status === 404) {
      skip('WS push round-trip (dev trigger)', 'DEV_TRIGGER_ENABLED=false on server — expected in production');
    } else {
      // Give the server a moment to push
      await new Promise((r) => setTimeout(r, 500));
      const got = received.find((m) => (m as Record<string, unknown>)?.kind === 'bundle_updated');
      if (got) ok('WS received bundle_updated push event');
      else fail('WS received bundle_updated push event', `received: ${JSON.stringify(received)}`);
    }
  } catch (err) {
    fail('WS /v2.0/ws connected', String(err));
    skip('WS push round-trip (dev trigger)', 'WS connection failed');
  } finally {
    ws?.close();
  }
}

// ─── Block 9: HaloPSA webhook ─────────────────────────────────────────────────

async function block9() {
  print.header('Block 9 — HaloPSA webhook');

  if (!MASTER_SECRET) {
    skip('all webhook tests', 'AGENTS_INTERNAL_SECRET not set');
    return;
  }
  if (!ORG_ID) {
    skip('all webhook tests', '--org not provided');
    return;
  }

  const orgSecret = deriveOrgSecret(ORG_ID);
  const webhookPath = `/internal/webhook/halopsa/${ORG_ID}/ticket-event`;
  const tid = state.ticketId || 'e2e-probe-000';

  // 9.1 Valid webhook
  {
    const { status, body } = await http(webhookPath, {
      method: 'POST',
      headers: { 'X-Internal-Secret': orgSecret },
      body: { ticket_id: tid },
    });
    const data = ((body as Record<string, unknown>)?.data) as Record<string, unknown> | undefined;
    if (status === 200 && data?.sent !== undefined) {
      ok('POST webhook (valid HMAC) → 200', `sent to ${data.sent} device(s)`);
    } else {
      fail('POST webhook (valid HMAC) → 200', `${status} ${JSON.stringify(body)}`);
    }
  }

  // 9.2 Bad secret
  {
    const { status } = await http(webhookPath, {
      method: 'POST',
      headers: { 'X-Internal-Secret': 'wrong' },
      body: { ticket_id: '123' },
    });
    if (status === 401) ok('POST webhook (bad secret) → 401');
    else fail('POST webhook (bad secret) → 401', `got ${status}`);
  }

  // 9.3 Missing ticket_id
  {
    const { status } = await http(webhookPath, {
      method: 'POST',
      headers: { 'X-Internal-Secret': orgSecret },
      body: { some_other_field: 'value' },
    });
    if (status === 400) ok('POST webhook (missing ticket_id) → 400');
    else fail('POST webhook (missing ticket_id) → 400', `got ${status}`);
  }

  // 9.4 Internal connections list
  {
    const { status, body } = await http('/internal/connections', {
      headers: { 'X-Internal-Secret': MASTER_SECRET },
    });
    const data = ((body as Record<string, unknown>)?.data) as Record<string, unknown> | undefined;
    if (status === 200 && typeof data?.count === 'number') {
      ok('GET /internal/connections → 200', `${data.count} device(s) connected`);
    } else {
      fail('GET /internal/connections → 200', `${status} ${JSON.stringify(body)}`);
    }
  }

  // 9.5 Connections auth
  {
    const { status } = await http('/internal/connections', {
      headers: { 'X-Internal-Secret': 'wrong' },
    });
    if (status === 401) ok('GET /internal/connections (bad secret) → 401');
    else fail('GET /internal/connections (bad secret) → 401', `got ${status}`);
  }
}

// ─── Block 13: V1.0 backward compat ──────────────────────────────────────────

async function block13() {
  print.header('Block 13 — V1.0 backward compatibility');

  if (!SITE_ID) {
    skip('v1.0 tests', '--site not provided');
    return;
  }

  // 13.1 Register new agent (no device_id)
  {
    const { status, body } = await http('/v1.0/register', {
      method: 'POST',
      body: {
        site_id: SITE_ID,
        hostname: 'e2e-v1-agent',
        version: '0.0.9-legacy',
        platform: 'windows',
      },
    });
    const data = ((body as Record<string, unknown>)?.data) as Record<string, unknown> | undefined;
    if (status === 200 && typeof data?.device_id === 'string') {
      state.v1DeviceId = data.device_id;
      ok('POST /v1.0/register (fresh) → 200', `device_id=${state.v1DeviceId}`);
    } else {
      fail('POST /v1.0/register (fresh) → 200', `${status} ${JSON.stringify(body)}`);
    }
  }

  // 13.2 Re-register with same device_id
  if (state.v1DeviceId) {
    const { status, body } = await http('/v1.0/register', {
      method: 'POST',
      body: {
        site_id: SITE_ID,
        hostname: 'e2e-v1-agent-updated',
        version: '0.0.10-legacy',
        platform: 'windows',
        device_id: state.v1DeviceId,
      },
    });
    const data = ((body as Record<string, unknown>)?.data) as Record<string, unknown> | undefined;
    if (status === 200 && data?.device_id === state.v1DeviceId) {
      ok('POST /v1.0/register (re-register) → same device_id');
    } else {
      fail('POST /v1.0/register (re-register) → same device_id', `${status} ${JSON.stringify(body)}`);
    }
  }

  // 13.3 Ticket create (JSON body, no PSA configured is still 200)
  if (state.v1DeviceId) {
    const { status, body } = await http('/v1.0/ticket/create', {
      method: 'POST',
      headers: { 'x-site-id': SITE_ID, 'x-device-id': state.v1DeviceId },
      body: {
        summary: 'E2E v1 ticket test',
        name: 'E2E User',
        email: 'e2e@example.com',
        phone: '5551234567',
        impact: '3',
        urgency: '2',
      },
    });
    const b = body as Record<string, unknown>;
    // Accept both 200 (success or PSA-not-configured) and 500 (PSA error)
    if (status === 200) {
      if (b?.data) ok('POST /v1.0/ticket/create → 200 ticket created', `ticket_id=${b.data}`);
      else if (b?.error) ok('POST /v1.0/ticket/create → 200 (PSA not configured, correct graceful response)');
      else ok('POST /v1.0/ticket/create → 200');
    } else {
      fail('POST /v1.0/ticket/create → 200', `${status} ${JSON.stringify(body).slice(0, 120)}`);
    }
  } else {
    skip('POST /v1.0/ticket/create', 'no v1 device_id');
  }

  // 13.4 Missing headers
  {
    const { status } = await http('/v1.0/ticket/create', {
      method: 'POST',
      body: { summary: 'x', name: 'x', email: 'x', phone: 'x', impact: '1', urgency: '1' },
    });
    if (status === 401) ok('POST /v1.0/ticket/create (no headers) → 401');
    else fail('POST /v1.0/ticket/create (no headers) → 401', `got ${status}`);
  }
}

// ─── List connections mode ────────────────────────────────────────────────────

async function listConnections() {
  if (!MASTER_SECRET) { console.error('AGENTS_INTERNAL_SECRET required'); process.exit(1); }
  const { status, body } = await http('/internal/connections', {
    headers: { 'X-Internal-Secret': MASTER_SECRET },
  });
  if (status !== 200) { console.error('Error:', status, body); process.exit(1); }
  const data = ((body as Record<string, unknown>)?.data) as Record<string, unknown>;
  const conns = (data.connections as Array<Record<string, unknown>>) ?? [];
  if (conns.length === 0) { console.log('No devices connected.'); return; }
  console.log(`\n${conns.length} connected device(s):\n`);
  for (const c of conns) {
    const state = c.readyState === 1 ? `${GREEN}OPEN${RESET}` : `${YELLOW}state=${c.readyState}${RESET}`;
    console.log(`  ${c.deviceId}  org=${c.orgId}  ${state}`);
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

if (LIST_CONNS) {
  await listConnections();
  process.exit(0);
}

const runBlock = (n: number) => BLOCK === null || BLOCK === n;

if (runBlock(1))  await block1();
if (runBlock(2))  await block2();
if (runBlock(3))  await block3();
if (runBlock(4)) {
  const formId = await block4();
  if (runBlock(5)) await block5(formId);
} else if (runBlock(5)) {
  await block5(null);
}
if (runBlock(6))  await block6();
if (runBlock(7))  await block7();
if (runBlock(8))  await block8();
if (WITH_WH && runBlock(9)) await block9();
if (!SKIP_V1 && runBlock(13)) await block13();

saveState();

const total = passed + failed + skipped;
console.log(`\n${BOLD}Results:${RESET}  ${GREEN}${passed} passed${RESET}  ${failed > 0 ? RED : DIM}${failed} failed${RESET}  ${DIM}${skipped} skipped${RESET}  ${DIM}(${total} total)${RESET}`);

if (failed > 0) {
  console.log(`\n${RED}${BOLD}FAILED${RESET}`);
  process.exit(1);
} else {
  console.log(`\n${GREEN}${BOLD}PASSED${RESET}`);
}
