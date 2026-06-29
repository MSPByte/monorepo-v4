# Projection

`backend/projection` consumes raw ingestion batches and writes normalized vendor
rows into `vendors.*` tables. It does not build canonical people/assets; that is
owned by `backend/normalize`. Projection must not query live vendor APIs; link
and enrichment steps operate only on `ingestor.*` and `vendors.*` data.

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
- `PIPELINE_ORG_IDS=<org-id>[,<org-id>]` limits workers to specific orgs across
  the backend pipeline. `PROJECTION_ORG_IDS` can override this for projection
  only.
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
8. Projection runs triggered linking steps, then triggered enrichment steps.
   Enrichment is never run before linking for the same completed sync run.

The first implementation supports Microsoft 365 Graph-backed facets:

- `m365_identities`
- `m365_groups`
- `m365_licenses`
- `m365_ca_policies`
- `m365_devices`
- `m365_oauth_grants`
- `m365_risky_users`

## Linking And Enrichment

Projection steps are explicit contracts. Each step declares:

- `kind`: `link` or `enrich`.
- `provider`: the provider it handles.
- `triggerFacets`: facets that can cause the step to run.
- `requiredFacets`: facets that must have completed successfully for the link.

After the final successful batch of a relevant M365 sync run, projection checks
dependencies and then runs matching `link` steps before matching `enrich` steps.

Microsoft 365 currently defines these linking steps from projected vendor data:

- Rebuilds `vendors.m365_identity_groups` from
  `vendors.m365_groups.member_external_ids`. The linker skips without deleting
  existing joins if groups were projected before that source field existed.
- Rebuilds `vendors.m365_policy_identities`,
  `vendors.m365_policy_groups`, and `vendors.m365_policy_roles` from CA policy
  conditions.

Microsoft 365 currently defines this enrichment step:

- Updates `vendors.m365_identities.mfa_enforced` from enabled MFA CA policies.

Role-based links depend on `vendors.m365_roles` being seeded with Microsoft
directory role templates.
