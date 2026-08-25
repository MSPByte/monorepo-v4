# OpenAPI-derived capabilities

This file covers the import → review → scaffold **tooling workflow**.
For the capability field reference, handler patterns, entity types, dynamic
sources, and human/AI responsibility split, see `CAPABILITY_AUTHORING.md`.

This directory is the execution and contract layer for automation package
capabilities. API coverage should grow from reviewed OpenAPI manifests, not
from one-off handler conventions.

## Two capability classes

- **Curated capabilities** compose vendor behavior into an MSP workflow. They
  may transform input, persist write-through data, or combine several API
  calls. Keep these as ordinary `Capability` definitions.
- **OpenAPI-derived capabilities** represent one vendor operation as closely as
  possible. Define them with `defineOpenApiCapability` and attach a reviewed
  `OpenApiOperationManifest` from `src/openapi.ts`.

Every vendor capability must declare `integration`. The catalog only exposes a
capability when that integration is configured; `activeLink` additionally
requires at least one active `integration_links` row. This is enforced in tRPC
and rechecked by the package worker.

## Authoring rules

1. Start with the vendor OpenAPI operation, not a UI label. Preserve its method,
   path, operation ID, parameters, body location, and successful status codes.
2. Use the stable ID `{integrationId}.{resource}.{verb}` in lower camel-case
   segments. Do not place API versions, display names, or implementation
   details in the ID.
3. Generate Zod input/output schemas from the selected request and response
   schemas. Keep optional vendor fields optional. Do not turn an uncertain
   property into `z.any()`; use `z.unknown()` temporarily and flag it for
   review.
4. Add `inputMeta` and `outputMeta` for every exposed field. Reuse canonical
   field types from `@mspbyte/shared`; use entity pickers and declared dynamic
   sources instead of raw resource IDs where a platform-backed option exists.
5. Mark secrets and returned credentials `sensitive`. They are encrypted and
   reveal-audited by the package runtime.
6. Do not invent `dynamicSource` values, field types, permissions, or error
   classes. Reuse a registered value or add the platform support in a separate,
   reviewed change.
7. Do not put credential handling, arbitrary fetch calls, or tenant DB access
   in a generated handler. The generic executor owns those concerns. Microsoft
   Graph is the first supported executor through `buildOpenApiRequest()` and
   `M365Connector.operations.execute()`; until another connector supports an
   operation, use a small typed adapter and retain the manifest as the
   source-of-truth metadata.

## Importing a Swagger/OpenAPI document

Use the importer to produce a review queue, never a live registry mutation:

```sh
bun run --cwd packages/capabilities import:openapi -- \
  --input /absolute/path/vendor-openapi.yaml \
  --output /absolute/path/vendor-candidates.json \
  --source https://vendor.example/openapi.yaml \
  --integration vendor-id \
  --vendor vendor-id \
  --connection configured|activeLink \
  --operation operationOne,operationTwo
```

`--connection` is **required** — use `activeLink` for integrations that need an
active site link (e.g. Microsoft 365), `configured` for tenant-wide credentials
(e.g. Datto RMM, HaloPSA). The command supports OpenAPI JSON and YAML, resolves
local component parameter references, derives operation IDs, paths, HTTP methods,
successful responses, and primitive parameter metadata. It refuses to overwrite
an existing output without `--overwrite`. Candidate IDs are derived from the
operation ID; the importer will error if two selected operations produce the same
slug.

Candidates are intentionally incomplete: a reviewer (or Claude following this
document) must complete body-field schemas, entity mappings, dynamic sources,
audit/permission metadata, sensitive fields, idempotency, and outputs before a
candidate becomes an executable registry capability.

## Review lifecycle

Candidate manifests are global MSPByte catalog artifacts, not tenant records.
Their lifecycle is:

```text
generated → approved → live
          ↘ rejected
```

Record a smoke-test run or evidence URL with every status change. Use:

```sh
bun run --cwd packages/capabilities review:openapi -- \
  --input generated/vendor-candidates.json \
  --operation vendor.operation-id \
  --status approved \
  --evidence package-run:<run-id> \
  --notes "Verified against a non-production tenant"
```

Only an approved candidate can move to `live`. `live` means its reviewed
manifest and executable adapter have been added to the registry; changing the
JSON lifecycle alone never grants runtime access.

The first checked-in batch is
`generated/microsoft-graph-v1.0-user-operations.candidates.json`. It contains
26 reviewed-queue candidates from Microsoft Graph v1.0 user, membership,
device, license, and authentication operations. Keep generated candidate files
small and resource-focused; split a large vendor specification into coherent
review batches rather than committing its full source document.

## Scaffolding from an approved candidate

Once a candidate is `approved`, generate a TypeScript stub to fill in:

```sh
bun run --cwd packages/capabilities scaffold:openapi -- \
  --input generated/vendor-candidates.json \
  --output-dir src/vendor/ \
  [--operation vendor.specific-operation-id] \
  [--overwrite]
```

The scaffold emits a `.ts` file per approved candidate containing the reviewed
manifest, auto-generated Zod input stubs derived from the parameter list, and
clearly marked `TODO` blocks for body schema, handler logic, and metadata. It
will not overwrite existing files unless `--overwrite` is passed.

After filling in the TODOs:

1. Export the capability from the vendor's `index.ts`.
2. Register it in `src/registry.ts`.
3. Run `bun run check-types` to validate.
4. Mark the candidate live with `review:openapi`.

## Review checklist

- The integration requirement matches the connector scope (`configured` vs
  `activeLink`).
- Path/query/header fields map to the OpenAPI document exactly.
- Writes declare the narrowest valid audit action and required permission.
- Destructive operations are explicit and do not get added solely from bulk
  generation without a product review.
- Outputs are useful to downstream package bindings and have stable semantic
  types where applicable.
- The operation works with a disabled/deleted integration: it must be hidden
  at authoring time and blocked before execution.
- For Graph operations, manifests may supply only a relative `/v1.0` path. The
  connector owns the host and authorization header, and rejects every other
  target.
