# Agent guide

## Start here

1. Read this file, then inspect the closest relevant code before editing.
2. Run `git status --short` first. Preserve uncommitted work that is not part
   of your task; it may belong to another developer or agent.
3. Keep changes narrow. Do not reformat unrelated files or change generated
   build output.
4. Run the smallest relevant validation before the full repository checks.

## Architecture and ownership

- `apps/frontend` is the SvelteKit web app. Route groups such as `(private)`
  organize files but do not appear in URLs. It uses Svelte 5 runes mode.
- `packages/trpc` owns server-side procedures, permission checks, and
  request-scoped tenant access. The browser should call tRPC, not databases.
- `packages/drizzle` contains tenant-service schema and migrations;
  `packages/drizzle-catalog` contains catalog/provisioning schema. Do not mix
  the two database responsibilities.
- `packages/shared` is the source of truth for shared permissions, integration
  metadata, domain types, and validation schemas. Prefer adding cross-cutting
  definitions here instead of copying strings or types.
- `backend/ingestion` → `backend/normalize` → `backend/policies` is the data
  pipeline. `backend/packages` executes automation packages. Shared queue IDs
  and enqueue behavior belong in `packages/pipeline`.
- `apps/agent` is the Tauri desktop app; `backend/agents` is its HTTP service.

## Conventions that prevent regressions

- Enforce authorization in tRPC procedures, not only by hiding frontend UI.
  Scope helpers from the request context must constrain tenant queries.
- Keep public tRPC input/output contracts validated with Zod. Add new routers
  to `packages/trpc/src/router.ts`.
- In Svelte components, follow the existing runes pattern (`$state`, `$derived`,
  `$effect`) and use `onclick`, `oninput`, and other current event attributes.
- Update `apps/frontend/src/lib/config/routes.ts` when a private page needs
  navigation or command-palette discoverability. Route permissions must match
  backend permissions.
- Treat migrations as append-only. Generate them from schema changes; do not
  edit migration snapshots by hand. Never run `db:push` against shared data
  unless the task explicitly calls for it.
- For automation capabilities, use the integration requirement and OpenAPI
  manifest conventions in `packages/capabilities/OPENAPI_CAPABILITIES.md`.
  The package UI is not the authorization boundary: catalog visibility and run
  eligibility must be enforced through tRPC and the package worker.
- Do not import a server implementation into client code. In particular,
  `AppRouter` imports in the frontend must remain type-only.

## Commands

```sh
bun install
bun run infra:up                         # Redis + Bull Board
bun run dev:web                          # frontend + local package dependencies
bun run dev:pipeline                     # workers, scheduler disabled
bun run lint                             # static check (delegates to types)
bun run check-types                      # all workspaces
bun run test:unit                        # fast, database-free tests
bun run check                            # types + unit tests
```

Use focused checks while editing:

```sh
bun run --cwd apps/frontend check
bun run check-types --filter=@mspbyte/trpc
bun run --cwd packages/shared test:unit
```

Environment variables and worker defaults live in `src/env.ts` files. Secrets
belong only in ignored environment files. Database migrations, tenant scripts,
and integration tests require deliberate credentials and are not safe default
validation commands.

## Change hygiene

- Before implementation, identify the owning layer (route, tRPC router, shared
  contract, schema, or worker) and make the smallest coherent change there.
- Before handoff, report the files changed, validation actually run, and any
  check not run because it needed unavailable infrastructure.
- If concurrent work touches the same files, do not overwrite or fold it into
  your patch without first reconciling the intent with the user.
