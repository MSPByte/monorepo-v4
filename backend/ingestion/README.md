# Ingestion Plan

`backend/ingestion` owns vendor fetches and writes immutable source data into
`ingestor.raw_batches` and `ingestor.raw_records`. It should not normalize,
project, evaluate policy, or write vendor/canonical tables.

## Boundaries

- Catalog DB resolves active customer organizations and tenant database
  connection strings.
- Tenant DB `public.integration_links` is the unit of work. A link maps to a
  vendor API boundary such as a Microsoft 365 tenant, Sophos site, or Datto
  site.
- Each ingestion job handles one link plus one source type/facet.
- Shared pipeline contracts live in `@mspbyte/pipeline` so normalize,
  projection, and policy stages can share queue names, job shapes, sync modes,
  and raw record operation semantics.

## Queue Shape

- Use BullMQ and Redis as in monorepo-v2.
- Scheduler enqueues link-scoped ingestion jobs into
  `orgQueueName(QUEUES.INGEST, orgId)`.
- BullMQ queue names, job names, and job IDs must not contain `:`.
- Ingestion workers run per active org or use org-scoped queue names, matching
  the v2 isolation model.
- Manual development jobs should use the same queue and job contract as
  scheduled jobs. The eventual frontend should call a thin API that validates
  org/link/type/mode, creates a `sync_runs` row, then enqueues the job.

## Adapter Contract

Adapters implement `IngestionAdapter` from `@mspbyte/pipeline`:

- `providerId`: integration ID, e.g. `microsoft-365`.
- `types`: supported raw source types/facets.
- `fetch(type, mode, cursor, context)`: async generator yielding pages of
  `RawRecordEnvelope` records and returning the next cursor.

Each raw record envelope must include a stable `externalId`. Providers that
emit deletions in delta feeds should set `op: "delete"`. Otherwise records
default to `op: "upsert"`.

## Sync Semantics

- Full syncs are complete snapshots for `(link_id, type)`.
- Incremental syncs are changes since the stored cursor.
- Full-sync deletion detection is reconciliation by absence: after all raw
  records for a full run are projected, projection compares projected entities
  for `(link_id, type)` against `raw_records` for the same `sync_run_id`.
- Incremental deletion detection requires explicit tombstones via
  `raw_records.op = "delete"`.
- `raw_batches.mode` denormalizes the run mode so downstream workers can decide
  whether absence is meaningful without joining `sync_runs`.

## First Implementation Slice

1. Redis/env setup and org-scoped worker management.
2. Adapter registry with an opt-in `dev` adapter for local pipeline testing.
3. DB helpers for runs, stages, batches, records, and sync context updates.
4. Scheduled enqueue from catalog orgs and tenant `integration_links`.
5. Manual enqueue entry point for development testing.
6. Add one real provider type end to end.
7. Add projection handoff after raw batch insert.

## Runtime

Required environment:

- `REDIS_URL`, defaults to `redis://localhost:6379`.
- `CATALOG_DATABASE_URL`, used by `@mspbyte/drizzle-catalog`.
- `ENCRYPTION_KEY`, used to decrypt tenant service connection strings.
- `MICROSOFT_CLIENT_ID` and `MICROSOFT_CLIENT_SECRET`, required for
  Microsoft 365 Graph ingestion.

Useful development flags:

- Scheduled ingestion is disabled by default outside production. Use
  `INGESTION_SCHEDULER_ENABLED=true` only when intentionally testing scheduled
  scans.
- Non-production runtimes only process catalog organizations where
  `organization.is_dev = true`. Production is detected when `INGESTION_ENV`,
  `APP_ENV`, or `NODE_ENV` is `production`.
- `PIPELINE_ORG_IDS=<org-id>[,<org-id>]` limits scheduler scans and workers to
  specific orgs across the backend pipeline. `INGESTION_ORG_IDS` can override
  this for ingestion only.
- `INGESTION_REQUIRE_DEV_ORGS=false` can disable the dev-org guard for a local
  one-off run, but should not be used for normal development testing.
- `INGESTION_ENABLE_DEV_ADAPTER=true` registers provider `dev` with type
  `dev_entities`.
- `INGESTION_WORKER_CONCURRENCY=4` controls per-org worker concurrency.
- `INGESTION_ACTIVE_RUN_STALE_MS=7200000` controls when a stuck active run is
  marked failed and allowed to be scheduled again.

Manual enqueue example:

```sh
INGESTION_ENABLE_DEV_ADAPTER=true bun --filter ingestion run enqueue:manual -- --org-id <org-id> --link-id <link-id> --type dev_entities --mode full
```

Microsoft 365 example:

```sh
bun --filter ingestion run enqueue:manual -- --org-id <org-id> --link-id <link-id> --type m365_identities --mode full
```

The first Microsoft 365 adapter covers Graph-backed facets:

- `m365_identities`
- `m365_groups`
- `m365_licenses`
- `m365_ca_policies`
- `m365_devices`
- `m365_oauth_grants`
- `m365_risky_users`

Exchange, Teams, mailbox forwarding, inbox rules, and domain config still need
PowerShell-backed runners before they should be registered as ingestion types.

## Test Strategy

- Unit-test adapter page handling, stable hashing, duplicate handling, and
  tombstone insertion.
- Integration-test DB writes for full and incremental runs.
- Queue tests should use a disposable Redis connection or a BullMQ-compatible
  test harness and verify job payload contracts rather than vendor behavior.
