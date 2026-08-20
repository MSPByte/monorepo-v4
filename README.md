# MSPByte

MSPByte is a multi-tenant operations platform for managed service providers. It
combines a SvelteKit web application, a Tauri endpoint agent, a typed tRPC API,
and BullMQ workers that ingest and normalize vendor data before evaluating
policies and executing automation packages.

## Repository map

| Path                       | Purpose                                                                         |
| -------------------------- | ------------------------------------------------------------------------------- |
| `apps/frontend`            | SvelteKit web application, served by Vercel's Node runtime                      |
| `apps/agent`               | Tauri desktop endpoint agent                                                    |
| `packages/trpc`            | Typed server API: authentication, authorization, and route-level business logic |
| `packages/drizzle`         | Tenant service database schema, migrations, and database client                 |
| `packages/drizzle-catalog` | Catalog database schema and tenant provisioning lookup                          |
| `packages/shared`          | Shared domain types, permission model, schemas, and integration metadata        |
| `packages/capabilities`    | Automation capability definitions and generators                                |
| `packages/pipeline`        | Shared BullMQ queues and pipeline orchestration                                 |
| `backend/ingestion`        | Vendor-data ingestion scheduler and worker                                      |
| `backend/normalize`        | Raw-data normalization worker                                                   |
| `backend/policies`         | Policy-evaluation worker                                                        |
| `backend/packages`         | Automation package execution worker                                             |
| `backend/agents`           | HTTP API consumed by the endpoint agent                                         |
| `infra`                    | Local Redis/Bull Board and tenant administration scripts                        |

The catalog database holds organization provisioning information. Application
data lives in an organization-specific service database, resolved through the
catalog. Keep that boundary intact: browser code talks to tRPC; routers obtain
the tenant database from the request context.

## Quick start

Prerequisites: Bun `1.3.11`, Docker, and development credentials for the
catalog and tenant databases.

```sh
bun install
bun run infra:up
bun run dev:web
```

`infra:up` provides Redis and Bull Board. The databases are configured through
environment variables and are not created by Docker Compose.

For pipeline work, run the web app in one terminal and the workers in another:

```sh
bun run dev:pipeline
```

Use `bun run dev:pipeline:scheduled` only when you intend to enable the
ingestion scheduler.

## Environment

Keep secrets in an ignored `.env` file. The common server-side variables are:

- `CATALOG_DATABASE_URL` and `MSP_DATABASE_URL`
- `ENCRYPTION_KEY`
- `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, and `BETTER_AUTH_TRUSTED_ORIGINS`
- `REDIS_URL` (defaults to `redis://localhost:6379` for workers)
- Microsoft OAuth/application credentials when working with Microsoft flows

Worker-specific variables, concurrency, and scheduler defaults are defined in
each worker's `src/env.ts`. Do not copy real credentials into source, test
fixtures, or agent instructions.

## Validation

```sh
bun run lint               # static check (delegates to the type checker)
bun run check-types        # checks all TypeScript/Svelte workspaces
bun run test:unit          # runs database-free unit tests
bun run check              # types + unit tests
```

Target a workspace while iterating to keep feedback fast, for example:

```sh
bun run --cwd apps/frontend check
bun run --cwd packages/shared test:unit
bun run check-types --filter=@mspbyte/trpc
```

Database migrations and integration tests need real, disposable database
credentials. Treat `db:push`, `db:migrate`, tenant-migration scripts, and
production-like integrations as intentional operations, not routine checks.

For more implementation and safety guidance, see [AGENTS.md](AGENTS.md).
