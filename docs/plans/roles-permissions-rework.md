# Roles & Permissions Rework — Staged Plan

**Status:** planning
**Owner:** @Mythidas
**Started:** 2026-07-22

Sequential migration. Each stage must be fully done, tested, and merged before the next stage starts. No customer-facing rollout until Stage 6 lands.

---

## Context recovery (read first if resuming cold)

**Problem.** Current permission model is a flat `{Resource}.{Action}` boolean bag on `roles.attributes`. Users have exactly one role (`users.role_id`). No scoping. Roles page is read-only. Cannot express MSP requirements: granular per-integration permissions, per-site/per-group scoping for external users (e.g., a customer contact who should only see their own 3 sites read-only).

**Target model.**
- Permissions are dotted paths derived from a shared tree (`Vendors.M365.Identities.Write`). Same catalog powers permission checks *and* audit `targetType`.
- `hasPermission` walks parents and honors Write→Read / Delete→Read implication at every level. Wildcards (`Vendors.M365.*`) supported.
- Roles are named permission bundles (`{ name, level, permissions: string[], is_system: bool }`).
- Grants attach `(user, role, scope)` where scope is `all` | list of `site_ids` | list of `group_ids`. Users can hold multiple grants.
- Every list endpoint filters by the caller's scoped grants via a central tRPC middleware.
- Route/nav gating checks prefix-any (`Vendors.*`), not exact.
- System roles are seeded per-tenant by a new `tenant-seed` command in `infra/scripts`, idempotent, driven off `SYSTEM_ROLES` in `packages/shared`.

**Non-goals for this plan.** Hierarchical permission tree UI picker, site-group scope UI, effective-permissions preview. Those are Phase 2, tracked at the bottom.

**Resource taxonomy (locked 2026-07-22).** Current `RESOURCES` in `auth.ts` is only `[Sites, Integrations, Users, Assets]` — insufficient. Stage 1 expands the top-level tree to:

- **Operational:** `Sites`, `Assets`, `People`, `Wiki`, `Vendors`, `Policies`, `Frameworks`, `Billing`, `Findings`
- **Configuration:** `Users`, `Roles`, `Integrations`, `Audit`
- **Meta:** `Global.Admin` retained as escape-hatch flag; `*` is the equivalent expressed via the evaluator's wildcard.

Sub-trees under `Vendors` (`Vendors.M365.Identities.*`, etc.) land in Phase 2 — Stage 1 seeds top-level Vendors only.

**System role catalog (locked 2026-07-22).** These are the exact `SYSTEM_ROLES` entries Stage 1 defines and Stage 3 seeds. Write implies Read (Stage 1 evaluator); Read is not listed alongside Write.

| Role | Level | Permissions | Notes |
|---|---|---|---|
| Global Administrator | 5 | `['*']` | Everything. Only role that can act on level-5 accounts. |
| Administrator | 4 | `['*']` | Same permission set as Global. `canActOnLevel` blocks editing level-5 users/grants — protection is level-based, not permission-based. |
| Support | 3 | `['Sites.Delete', 'Assets.Delete', 'People.Delete', 'Wiki.Delete', 'Vendors.Delete', 'Policies.Delete', 'Frameworks.Delete', 'Billing.Delete', 'Findings.Delete']` | Full operational read/write/delete. No config surface (Users/Roles/Integrations/Audit). Delete implies Write and Read via evaluator. |
| Helpdesk | 2 | `['Sites.Write', 'Wiki.Write', 'Assets.Read', 'People.Read', 'Vendors.Read', 'Policies.Read', 'Frameworks.Read', 'Billing.Read', 'Findings.Read']` | Operational read + write on Wiki and Sites only. |
| Auditor | 1 | `['Sites.Read', 'Assets.Read', 'People.Read', 'Wiki.Read', 'Vendors.Read', 'Policies.Read', 'Frameworks.Read', 'Billing.Read', 'Findings.Read']` | Read-only operational. |

Owner is the bootstrap-only role (level 100, `['*']`, `is_system=true`) minted by `provision-better-auth-org.ts`; it is not part of `SYSTEM_ROLES` because it's not reseeded — it's tied to the provisioning act.

**Key files by touchpoint (as of 2026-07-22):**
- Permission types & eval — `packages/shared/src/lib/auth.ts`
- Tenant DB roles/users — `packages/drizzle/src/db/public/index.ts`
- Audit target type (free text) — `packages/drizzle/src/db/audit/index.ts:22`
- Bootstrap owner — `packages/drizzle-catalog/src/seeds/provision-better-auth-org.ts`
- CLI harness — `infra/scripts/src/index.ts`
- CLI patterns to mirror — `infra/scripts/src/tenant-health/index.ts`
- Roles tRPC router — `packages/trpc/src/routers/roles.ts`
- Roles page — `apps/frontend/src/routes/(private)/(core)/setup/roles/+page.svelte`
- Users page — `apps/frontend/src/routes/(private)/(core)/setup/users/`
- Route gating — `apps/frontend/src/lib/config/routes.ts`
- Auth store — `apps/frontend/src/lib/stores/auth.store.svelte.ts`

---

## Stage 1 — Foundation: permission tree & evaluator

**Goal.** Introduce the dotted-path permission model as pure code in `@mspbyte/shared`. No schema changes. New evaluator handles both legacy boolean bag AND `string[]` so nothing breaks downstream.

**Changes.**
- In `packages/shared/src/lib/auth.ts`:
  - Add `PERMISSION_TREE` const (nested `as const` object). Seed with existing resources; leave `Vendors.M365.Identities` etc. as placeholders for real sub-entities.
  - Derive `type Permission` from the tree (dotted-path union) — replaces the current `${Resource}.${Action}` template.
  - Add `type PermissionGrant = { permissions: string[]; scope: Scope }` and `type Scope = { kind: 'all' } | { kind: 'sites'; ids: string[] } | { kind: 'groups'; ids: string[] }`.
  - Rewrite `hasPermission(grants: PermissionGrant[] | LegacyAttributes, required: Permission)`:
    - Legacy path: keep current behavior for the boolean bag.
    - New path: for each grant, check exact match, then walk prefixes (`a.b.c` → `a.b.*` → `a.*` → `*`), applying Write/Delete → Read implication at each level.
  - Add `hasAnyPermissionUnder(grants, prefix)` for route/nav checks.
  - Add `SYSTEM_ROLES` const with the 5 entries from the locked catalog above (Auditor..Global Administrator). Shape: `{ name, level, description, permissions: string[], is_system: true }`.
- Add unit tests (new file, colocated) covering: exact match, prefix walk, wildcard, Write→Read implication, Delete→Read implication, Delete→Write implication, mixed grant list, empty grants, legacy bag compatibility.
- **Route map rewrite (folded into this stage).** Update `apps/frontend/src/lib/config/routes.ts` to gate each operational page on its real resource, not `Assets.Read`:
  - `/findings` → `Findings.Read`
  - `/wiki` → `Wiki.Read`
  - `/people` → `People.Read`
  - `/policies` → `Policies.Read`
  - `/frameworks` → `Frameworks.Read`
  - `/billing` → `Billing.Read`
  - `/setup/roles` → `Roles.Read` (was `Users.Read`)
  - `/setup/audit` → `Audit.Read` (was `Global.Admin`)
  - Others (`/home`, `/assets`, `/sites`, `/groups`, `/setup/users`, `/setup/sites`, `/setup/integrations`) already correct.
  - This must ship in the same PR as the shared consts — the nav breaks otherwise the moment `RESOURCES` grows.

**Acceptance.**
- `bun test` passes new suite.
- `bun run check-types` clean across the workspace.
- Legacy callers still compile and behave identically (spot-check `apps/frontend/src/lib/config/routes.ts` and `hooks.server.ts`).

**Verify.**
- `bun test packages/shared`
- `bun run --filter '@mspbyte/frontend' check-types`

**Rollback.** Revert the single commit. No data changed.

---

## Stage 2 — Schema migration: grants table, permissions column, is_system

**Goal.** Migrate tenant DB shape to support multi-grant, scoped, system-tagged roles. Backfill existing single-role users into the new grants table so nobody loses access.

**Changes.**
- `packages/drizzle/src/db/public/index.ts`:
  - Add columns to `roles`: `permissions: text('permissions').array().notNull().default([])`, `is_system: boolean('is_system').notNull().default(false)`.
  - Keep `attributes` jsonb *temporarily* — do not drop yet. Column is legacy; Stage 4 removes it.
  - New table `user_role_grants`:
    ```
    id uuid pk default random
    user_id uuid not null references users(id) on delete cascade
    role_id uuid not null references roles(id) on delete restrict
    scope_kind text not null check in ('all','sites','groups')
    scope_ids uuid[] not null default '{}'
    created_at, updated_at timestamps
    unique(user_id, role_id, scope_kind, scope_ids)  -- prevent dup grants
    index on (user_id)
    ```
  - Mark `users.role_id` as deprecated in a comment but keep the column live until Stage 4.
- Generate drizzle migration. Hand-audit the SQL.
- Add a data-migration step in the same migration file that:
  - For every row in `users` where `role_id is not null`: insert `user_role_grants(user_id, role_id, 'all', '{}')`.
  - For every row in `roles`: derive `permissions` from `attributes` (translate boolean bag keys with value=true → array). If `attributes` has `Global.Admin: true`, permissions gets `['*']`.
- No code that reads `attributes` changes yet — Stage 1's evaluator still supports it.

**Acceptance.**
- Migration runs cleanly on a fresh tenant DB and on a snapshot of the dev tenant.
- Post-migration: `select count(*) from user_role_grants` equals count of `users where role_id is not null`.
- `select id, name, attributes, permissions from roles` — permissions array is a faithful translation of attributes for every row.
- Every existing user can still log in and see the same nav as before (Stage 1 evaluator handles both).

**Verify.**
- Run migration against a copy of the dev tenant DB.
- Manual login as each seeded role, check nav & one gated action per role.
- Diff a random sample of `roles.attributes` vs `roles.permissions` translations.

**Rollback.** Migration must have a down step: drop `user_role_grants`, drop new columns on `roles`. `attributes` untouched, so revert is clean.

---

## Stage 3 — Seed CLI: `tenant-seed` command

**Goal.** Move ongoing system-role reconciliation into `infra/scripts`. `SYSTEM_ROLES` from `@mspbyte/shared` becomes the source of truth; `tenant-seed --all` reconciles every tenant DB idempotently.

**Changes.**
- New directory `infra/scripts/src/tenant-seed/` mirroring `tenant-health/`:
  - `index.ts` — `runTenantSeed(opts)`, org iteration, `--only` filter, exit codes matching health script.
  - `system-roles.ts` — one seeder. For each entry in `SYSTEM_ROLES`, upsert by `name`: set `level`, `description`, `permissions`, `is_system=true`. Do **not** delete unknown system roles (never remove a role a customer might have grants against — mark deprecated in code and drop in a follow-up migration if needed).
- Register in `infra/scripts/src/index.ts` as `tenant-seed` command with usage text mirroring `tenant-health`.
- `packages/drizzle-catalog/src/seeds/provision-better-auth-org.ts`: reduce the inline role insert to just the Owner (level 100, `permissions: ['*']`, `is_system: true`). Bootstrap only. All other roles come from the seed CLI.

**Acceptance.**
- `bun infra/scripts/src/index.ts tenant-seed --org=<dev-uuid>` prints per-check status like `tenant-health`.
- Running it twice is a no-op the second time (idempotent).
- After a fresh `provision-better-auth-org` + `tenant-seed`, the tenant has Owner + all 5 system roles.
- Changing a `permissions` entry in `SYSTEM_ROLES`, re-running `tenant-seed --all`, updates every tenant.
- `--only=system-roles` works; unknown `--only` value exits 1 with a helpful list.

**Verify.**
- Provision a throwaway tenant end-to-end.
- Run seed twice, diff DB state.
- Add a fake permission to a system role, re-seed, verify update.

**Rollback.** CLI is additive. Revert the commit; `provision-better-auth-org.ts` change is the only tenant-touching part and it degrades gracefully (Owner still gets created).

---

## Stage 4 — Server enforcement: middleware, guards, drop legacy

**Goal.** Every server path enforces the new grant model. Retire `users.role_id` and `roles.attributes`.

**Changes.**
- Update tRPC context (`packages/trpc/src/context.ts` and `packages/trpc/src/trpc.ts` if separate) to load the caller's grants:
  - Query `user_role_grants join roles` for the current user; produce `ctx.grants: PermissionGrant[]`.
  - Attach a helper `ctx.can(permission)` and `ctx.canUnder(prefix)` backed by Stage 1 evaluator.
- Replace `authProcedure` gate logic to use `ctx.can`.
- Add `scopedListMiddleware`:
  - Reads `ctx.grants`, computes effective site-id set (union of `sites` scopes; `all` = unbounded; `groups` = expand to member sites).
  - Exposes on `ctx.scope.siteIds: string[] | 'all'`.
  - Each list endpoint that returns site-attached records opts in by consuming `ctx.scope.siteIds` and adding `WHERE site_id IN (...)` (or short-circuiting to empty when list is empty and kind !== 'all').
- Grep every router in `packages/trpc/src/routers/` for `.query(` returning site-scoped data. Wire each through `ctx.scope`.
- Migration:
  - Drop `users.role_id` column.
  - Drop `roles.attributes` column.
  - Remove legacy-bag branch in `hasPermission`.
- Update `apps/frontend/src/lib/server/trpc.ts` and `hooks.server.ts` if they reference `role_id` or `attributes`.

**Acceptance.**
- All tRPC routers compile. `bun run check-types` clean.
- Manual: an admin user with `'*'` sees all sites; a user with a `sites` scope grant sees only that scope in every list; a user with no grant covering `X.Read` gets an empty list on `X.list` and a permission error on `X.getById`.
- Attempting to bypass scope by passing an out-of-scope `siteId` in a mutation returns unauthorized, not silently accepts.
- No callers reference `users.role_id` or `roles.attributes`.

**Verify.**
- Manual smoke: log in as three seeded users (admin, scoped internal, scoped external stub) — check `/sites`, `/assets`, `/people`.
- Integration test: two users in the same tenant, one scoped, both hit `sites.list`, get correct filtered results.

**Rollback.** Higher risk stage. Only merge after Stage 3 has been in prod at least 24h. Migration down step restores `attributes` and `role_id` — evaluator's legacy branch must be preserved in a revert branch, not deleted, until this stage is confirmed stable.

---

## Stage 5 — Client gating: prefix routes, nav filter, auth store

**Goal.** UI reflects the new grant model. Nav hides subtrees the user can't touch. Scoped users see filtered lists silently.

**Changes.**
- `apps/frontend/src/lib/config/routes.ts`:
  - Change `Route.permission: Permission` to `Route.permission: Permission | { prefix: string }`.
  - Update `getRoutePermission` to return the union; a helper `canSeeRoute(grants, route)` uses `hasPermission` or `hasAnyPermissionUnder` appropriately.
  - Add sub-routes for integrations under a `Vendors` group so nav can hide entire integrations for users without grants (`Vendors.M365.*`, `Vendors.Cove.*`, etc.). Concrete entries TBD when integration menu design is settled — placeholder is fine, Phase 2 finalizes.
- `apps/frontend/src/lib/stores/auth.store.svelte.ts`: expose `grants: PermissionGrant[]` in place of the old attributes bag. Add `can(perm)` / `canUnder(prefix)` getters.
- Every `hasPermission(attributes, ...)` call site in `apps/frontend/src/` updated to use the new store.
- List views (sites, assets, people, groups): no changes needed — they already call tRPC, and Stage 4's middleware filters server-side. Confirm the empty-state copy is neutral ("No sites yet") not "You lack permission" — users shouldn't be able to distinguish "empty" from "scoped-out."
- Route map rewrite already done in Stage 1 — this stage only adds prefix-support to `Route.permission` and the `hasAnyPermissionUnder`-based nav filter.
- Deep-link protection: single-record loaders on private routes should surface the tRPC permission error as a `404` not a `403`, so scoped users can't enumerate.

**Acceptance.**
- Logging in as a scoped user shows only accessible nav.
- No dev-tools inspection reveals the full nav tree for a scoped user (the filter is server-driven — the layout server load must not send hidden routes down).
- Direct URL to a scoped-out route redirects/404s.
- `bun run check-types`, `bun run lint`, `bun run build` clean.

**Verify.**
- Playwright or manual: three test users (admin / scoped-internal / scoped-external) walk the app; screenshots of nav for each.
- Attempt `/sites/<not-in-scope-id>` deep link as a scoped user → 404.

**Rollback.** UI-only; revertable.

---

## Stage 6 — Roles CRUD & user assignment UI

**Goal.** MSP admins can create/edit/delete custom roles and assign grants to users. System roles are read-only. This is the customer-visible surface — nothing ships before this stage passes review.

**Changes.**
- `packages/trpc/src/routers/roles.ts`: add `create`, `update`, `delete` procedures. All gated on `Users.Write` (or a new `Roles.Write` if that debate lands). Server-side guards:
  - `is_system=true` → 403 on update (of permissions or level) and delete.
  - Cannot delete a role that has active grants — return conflict with count.
  - `level` must be `<= caller's max grant level` to prevent privilege escalation.
- `apps/frontend/src/routes/(private)/(core)/setup/roles/+page.svelte`: full CRUD.
  - List keeps current shape; add "New role" button, row actions.
  - Editor drawer/dialog: `name`, `description`, `level` (dropdown from `ROLE_LEVELS`), `permissions` (flat multi-select for now — tree picker is Phase 2), `is_system` shown as read-only badge.
  - Confirm-delete with grant-count warning.
- User assignment on `/setup/users`:
  - Row expands to show current grants.
  - Add grant: pick role, pick scope (`all` / site multi-select for now; groups is Phase 2).
  - Remove grant.
  - Backend endpoints in `packages/trpc/src/routers/users.ts` (or a new `grants.ts`) with the same escalation guard.
- Audit hooks: every role create/update/delete and every grant add/remove logs to `customerLogs` with `targetType` from the permission catalog (Stage 4 will already have `targetType` constrained; this stage just ensures we log).

**Acceptance.**
- Admin creates a custom role, assigns it to a test user scoped to two sites, that user sees exactly those two sites and cannot escalate.
- System roles cannot be edited or deleted through the UI or a raw tRPC call.
- Deleting a role with grants surfaces the count and blocks.
- A user with `level=3` cannot create a role at `level=4` or grant themselves one.
- All CRUD actions produce audit log entries with structured `targetType`.

**Verify.**
- Manual walkthrough of every customer story:
  1. Internal admin (unscoped) creates "Client Portal — Read Only" role.
  2. Admin invites external contact, assigns Client Portal role scoped to sites [A, B].
  3. Contact logs in, sees only A and B in `/sites`, cannot navigate to `/setup/*`, cannot mutate anything.
  4. Admin edits the role's permissions; contact's access changes on next request.
  5. Admin deletes the role after removing the grant.
- Run through `packages/trpc` router tests.

**Rollback.** UI + tRPC endpoints. Revert is safe up to this stage's data (any customer-created custom roles disappear on rollback — communicate before shipping).

---

## Phase 2 (out of scope — track separately)

- Hierarchical permission tree picker (searchable, expand/collapse, "check parent → check children" UX).
- Site-group scoping (grants against `site_groups`, expand to sites at eval time).
- "Effective permissions" preview modal on the user page ("what can Jane actually see across her grants?").
- Integration sub-tree in `SYSTEM_ROLES` (per-integration permissions like `Vendors.M365.Identities.Write`).
- Constraining audit `customerLogs.targetType` to the permission catalog enum (currently free text; useful but not blocking).
- Deprecation-and-drop pass for any system roles renamed since launch.

---

## Working agreements

- One stage per PR. No batching stages.
- Every stage's "Verify" section is executed and results pasted into the PR before merge.
- Stage 4 does not merge until Stage 3 has run in prod for 24h.
- Stage 6 does not ship to any customer until an internal team member has completed the full Verify walkthrough end-to-end.
- If a stage's acceptance uncovers a design gap, stop and update this doc before writing more code.
