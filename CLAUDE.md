# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

MSPByte is a multi-tenant operations platform for managed service providers. It ingests vendor data, normalises it into canonical assets, evaluates compliance policies, and executes automation packages — all scoped per-organisation.

---

## Commands

```sh
bun install
bun run infra:up                      # Redis + Bull Board (Docker required)
bun run dev:web                       # SvelteKit + tRPC (no workers)
bun run dev:pipeline                  # All workers, scheduler disabled
bun run dev:pipeline:scheduled        # Workers with ingestion scheduler enabled
```

Validation:

```sh
bun run check                         # types + unit tests (default pre-PR check)
bun run check-types                   # all TypeScript/Svelte workspaces
bun run test:unit                     # bun test packages/shared/src only
bun run lint                          # delegates to check-types

# Focused workspace checks while iterating:
bun run --cwd apps/frontend check
bun run --cwd packages/shared test:unit
bun run check-types --filter=@mspbyte/trpc
```

**Migrations:** hand-write SQL migrations and apply them with `infra/scripts/tenant-migrate`. Never use `drizzle-kit generate` or `db:push` against shared data.

---

## Architecture

### Deployment split

- **Frontend** (`apps/frontend`) — SvelteKit, deployed to **Vercel**. Communicates with the backend exclusively via tRPC. **Cannot reach Redis.**
- **Backend workers** (`backend/*`) — BullMQ workers, deployed to **Railway**. Can reach Redis and the tenant DB. Cannot be called directly from the frontend.
- The **DB is the only bridge** between frontend and backend. When a tRPC mutation needs to trigger backend work, it writes a pending row; a poller in the worker picks it up (see Packages pattern below).

### Data flow

```
integrationLinks (active) → ingestion worker
  → syncRuns row created → BullMQ job on ingest__<orgId>
  → adapter.fetch() pages → projectBatch() per page
  → normalize job enqueued on normalize__<orgId>
  → normalizeProjectedRun() → people/assets tables
  → policy job enqueued on policy__<orgId>
  → evaluatePolicies() + evaluateFactRules() → findings
```

The ingestion worker's `finally` block always calls `scheduleNextRun()`, so the cycle is self-sustaining on both success and failure. A safety-net scheduler in `backend/ingestion/src/scheduler.ts` also scans all active orgs on each tick and enqueues any (link, facet) pairs not already in BullMQ.

### Package layers

| Package | Role |
|---|---|
| `packages/trpc` | All server-side procedures. Authorization via `ctx.can()` / `ctx.scopeFor()` / `ctx.linkScopeFor()`. |
| `packages/drizzle` | Tenant service DB schema and client. Schema groups: `public`, `canonical`, `ingestor`, `policy`, `vendors`, `packages`, `audit`, `billing`, `wiki`. |
| `packages/drizzle-catalog` | Catalog DB — org provisioning, `getTenantServiceDbByOrgId()`. Never mix with tenant schema. |
| `packages/shared` | Source of truth for integration metadata (`INTEGRATIONS` map), `ProviderFacet`/`ProviderId` types, permission model, Zod schemas. |
| `packages/pipeline` | Shared BullMQ queue names (`ingest__<orgId>`, `normalize__<orgId>`, `policy__<orgId>`, `package__<orgId>`), `enqueueIngestionJob()`, `enqueuePolicyJob()`. |
| `packages/connectors` | Vendor API clients (M365, Sophos, Datto RMM, Cove, HaloPSA). |
| `packages/capabilities` | Automation capability definitions and generators for the packages system. |

### tRPC context

`packages/trpc/src/context.ts` resolves the tenant org from the session, opens the tenant DB, and loads permission grants. Key context fields used inside routers:

- `ctx.db` — tenant Drizzle client
- `ctx.can(permission)` — boolean permission check
- `ctx.scopeFor(permission)` — returns `{ siteIds }` constrained to what the user can see
- `ctx.linkScopeFor(permission)` — returns `{ linkIds }` after resolving site groups
- `ctx.redis` — ioredis client (available server-side; **not** available in the browser)

### Ingestion adapter contract

Each integration's adapter lives in `backend/ingestion/src/adapters/<provider>/`. An adapter implements `fetch()` (async generator of record pages), optional `project()` for per-record transformation, and declares which `ProviderFacet` types it supports. The facet list from `packages/shared/src/config/integrations/<provider>/` drives which facets the scheduler plans and which DB tables are populated.

### Packages execution pattern (DB→Redis bridge)

Because the frontend cannot reach Redis:
1. tRPC writes a `packageRuns` row with `status: 'pending'`.
2. A `pendingRunsPoller` in `backend/packages/src/workers/` polls every 2 s, atomically flips to `status: 'queued'`, and enqueues the BullMQ job.
3. The package worker executes steps sequentially, supporting cancellation between steps by re-reading `packageRuns.status` live.

This same DB-bridge pattern should be used for any new backend work triggered from tRPC mutations.

### Automation capability catalog and OpenAPI expansion

- A capability's `vendor` is display metadata. Vendor-backed capabilities must
  also declare `integration: { integrationId, connection }` in
  `packages/capabilities`; use `configured` for tenant-wide credentials and
  `activeLink` when an executable vendor link is required.
- `packages.capabilities` returns only capabilities whose integration is set up
  for the tenant. Creation/update, manual/scheduled launch, and the package
  worker all enforce the same availability check. Do not reintroduce a static,
  unfiltered catalog or rely on hidden UI as an authorization boundary.
- OpenAPI-derived operations use `OpenApiOperationManifest` and
  `defineOpenApiCapability` from `packages/capabilities/src/openapi.ts`. The
  full authoring and review rules are in
  `packages/capabilities/OPENAPI_CAPABILITIES.md`; read it before adding
  Swagger-generated capabilities.
- Keep two layers: a vendor-faithful endpoint capability for API coverage and
  a curated capability/package for opinionated MSP workflows. Generated code
  must not implement credentials, arbitrary fetch calls, direct DB access, or
  made-up dynamic field sources. Those remain trusted platform code.
- Microsoft Graph is the first supported manifest executor:
  `buildOpenApiRequest()` maps reviewed path/query/body fields and
  `M365Connector.operations.execute()` owns the Graph host, auth, and HTTP
  call. Never bypass it with a generated URL or `fetch`; add equivalent
  connector support before enabling OpenAPI operations for another vendor.
- To bulk-start a vendor catalog, run `bun run --cwd packages/capabilities
  import:openapi -- ...` with an explicit `--operation` allowlist. It emits a
  reviewable JSON candidate file only; do not treat generated candidates as
  approved executable capabilities.
- The initial Microsoft Graph user-operation review queue is at
  `packages/capabilities/generated/microsoft-graph-v1.0-user-operations.candidates.json`.
  Promote candidates in coherent batches through the manifest executor; do not
  register all imported operations at once.
- OpenAPI candidates follow `generated → approved → live` (or `rejected`).
  Record smoke-test evidence with `review:openapi`; a lifecycle JSON change
  alone does not make a candidate executable. Global catalog approval and an
  MSP's integration availability are separate checks.

### Policy assignment and findings lifecycle

- `policyAssignments` rows connect a `policy` (or `policySet`) to a scope (site, link, site group, or tenant).
- Policy evaluation runs only as the tail of an ingestion cycle (`normalize → policy`). It does not run on its own schedule.
- `resolveStaleFindings()` closes findings for scopes that no longer have matching data in the current run. It only runs during an active evaluation pass — it is **not** called when an assignment is deleted. Deleting an assignment without closing its findings leaves them orphaned.
- When checking whether to act on an assignment change, verify no other assignment still covers the same `(policyId, scope)` — a policy can be assigned directly and through multiple frameworks simultaneously.

---

## Design principles

These apply to every editor, dialog, and data entry surface across the product. They represent validated decisions, not suggestions — do not override them without explicit instruction.

- **Hide internals from the end user.** DB keys, value modes, display orders, and type enums are implementation details. Never expose them as raw labels. Auto-generate keys from labels; map all enums through plain-English display strings (sentence-case, not lowercase).
- **One type picker, not three fields.** Merge `type`, `valueMode`, and `valueType`/semantic type into a single unified "Field Type" selector with friendly names: Text, Number, Yes / No, List, Time Zone, UUID, etc. Each option fully resolves the underlying tuple.
- **Managed inputs over raw inputs.** If a type has a smart widget (timezone picker with offsets, country selector, UUID validator), the UI must use it. Never fall back to a free-text box for a type with a managed experience.
- **Compress binary choices.** A 2-option dropdown (single/multiple, yes/no, executive/context) should be replaced with inline toggle buttons or a segmented control — never a full Select component.
- **Drag-to-reorder, not an order number field.** Sortable tables use drag handles; the `displayOrder` column is an implementation detail that the user never sees or types.
- **No auto-seeding.** Do not add `BUILT_IN_*` constant arrays to `packages/shared` for production features. Default catalog entries are created by the user through the UI, not injected on first query. `ensureCatalogDefaults`-style patterns are MVP scaffolding and must not be introduced in new features.
- **The product should feel like it's doing the work.** Prefer derived/computed fields, smart defaults, and context-aware inputs. Empty forms are a last resort.
- **Platform field types are shared contracts.** Site facts, package inputs and outputs must resolve through `packages/shared/src/types/field-types.ts`; do not recreate a local list of type options. Where a type supports one or many values, expose a compact Modality selector and resolve it to the exact canonical contract internally. Integration-backed types are gated by enabled integration links, grouped by their integration in pickers, and use scoped entity pickers rather than raw identifiers. UUIDs and UPNs are package-input details, not site-fact types.
- **Tenant integrations need two separate relationships.** For tenant-scoped providers such as Microsoft 365, the active parent link owns ingestion and all vendor rows. Site-to-tenant eligibility must be modeled independently from domain-to-site attribution: domains assign identities to a site, while a tenant can be usable by many sites even when they share one domain. A site may belong to only one Microsoft 365 tenant; enforce that in the database and make conflicting assignments visibly unavailable in the UI. Never treat a site mapping child link as an ingestion link or query vendor rows by its ID; resolve it to the active parent link. Prefer a normalized tenant-link↔site relation over synthetic per-site integration links when expanding this model.

---

## Conventions

- **Authorization in tRPC, not UI.** Use `ctx.scopeFor()` / `ctx.linkScopeFor()` to constrain all DB queries; never rely on hiding a frontend page.
- **New tRPC routers** must be added to `packages/trpc/src/router.ts` and exported from `appRouter`.
- **New navigable pages** must be registered in `apps/frontend/src/lib/config/routes.ts` so they appear in the command palette and get correct permission checks.
- **Error surfacing:** use `$lib/utils/errors` (`toUserMessage()`) for all user-facing error text. Log raw errors to console only.
- **Svelte 5 runes:** use `$state`, `$derived`, `$effect`; event attributes are `onclick`, `oninput`, etc.
- **Cross-cutting types and constants** (integration IDs, permission strings, facet enums) belong in `packages/shared`, not copied into individual packages.
- **OpenAPI capability metadata** belongs in `packages/capabilities/src/openapi.ts` and each reviewed capability definition. Do not make an AI prompt or an external Swagger document the runtime source of truth.
- **Schema groups in `packages/drizzle`** reflect domain boundaries (`policy`, `ingestor`, `canonical`, `vendors`, etc.). Add new tables to the correct group; do not put everything in `public`.
