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

1. Add Redis/env setup and an ingestion worker factory.
2. Add adapter registry with no vendor implementations beyond a test adapter.
3. Add DB helpers for creating runs, batches, records, and sync context updates.
4. Implement manual enqueue entry point for development testing.
5. Add one real provider type end to end.
6. Add projection handoff after raw batch insert.

## Test Strategy

- Unit-test adapter page handling, stable hashing, duplicate handling, and
  tombstone insertion.
- Integration-test DB writes for full and incremental runs.
- Queue tests should use a disposable Redis connection or a BullMQ-compatible
  test harness and verify job payload contracts rather than vendor behavior.
