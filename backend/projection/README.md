# Projection

`backend/projection` consumes raw ingestion batches and writes normalized vendor
rows into `vendors.*` tables. It does not build canonical people/assets; that is
owned by `backend/normalize`.

## Runtime

- Workers listen on org-scoped `project` queues.
- Non-production runtimes only start workers for catalog organizations where
  `organization.is_dev = true`.
- Production is detected when `PROJECTION_ENV`, `INGESTION_ENV`, `APP_ENV`, or
  `NODE_ENV` is `production`.

Required environment:

- `REDIS_URL`, defaults to `redis://localhost:6379`.
- `CATALOG_DATABASE_URL`, used by `@mspbyte/drizzle-catalog`.
- `ENCRYPTION_KEY`, used to decrypt tenant service connection strings.

Useful settings:

- `PROJECTION_WORKER_CONCURRENCY=6`
- `PROJECTION_REQUIRE_DEV_ORGS=false` for an explicit local override.

## Data Flow

1. Ingestion writes `ingestor.raw_batches` and `ingestor.raw_records`.
2. Ingestion enqueues one projection job per raw batch.
3. Projection reads pending raw records for that batch.
4. Projection normalizes raw payloads into vendor table rows.
5. Projection stores `source_hash` from `raw_records.payload_hash`.
6. Projection marks raw records and raw batches completed or failed.
7. Projection marks the sync run completed once all batches are no longer
   pending.

The first implementation supports Microsoft 365 Graph-backed facets:

- `m365_identities`
- `m365_groups`
- `m365_licenses`
- `m365_ca_policies`
- `m365_auth_methods`
- `m365_devices`
- `m365_oauth_grants`
- `m365_risky_users`
