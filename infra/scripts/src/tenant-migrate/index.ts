import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { eq, sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import {
  getCatalogDb,
  getTenantServiceDbByOrgId,
  organization,
} from "@mspbyte/drizzle-catalog";
import { env, requireEncryptionKey } from "../env.js";

// Baseline migration name. Any tenant DB whose schema was created via
// drizzle-kit push (i.e. before we started committing migrations) already has
// the objects this migration would create — we stamp it as applied so the
// migrator skips it and moves to the delta.
const BASELINE_MIGRATION_NAME = "20260722170747_shallow_overlord";

// Resolve the migrations folder from the drizzle package. `import.meta.dirname`
// points at .../infra/scripts/src/tenant-migrate/. Four levels up hits the
// monorepo root; then into the drizzle package's migrations folder.
const MIGRATIONS_FOLDER = path.resolve(
  import.meta.dirname,
  "../../../../packages/drizzle/drizzle",
);

export type RunTenantMigrateOptions = {
  orgId?: string;
  all: boolean;
};

type MigrationRecord = {
  name: string;
  hash: string;
  createdAt: number;
  sqlPath: string;
};

function loadLocalMigrations(): MigrationRecord[] {
  if (!fs.existsSync(MIGRATIONS_FOLDER)) {
    throw new Error(`Migrations folder missing: ${MIGRATIONS_FOLDER}`);
  }
  const entries = fs
    .readdirSync(MIGRATIONS_FOLDER, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();

  const records: MigrationRecord[] = [];
  for (const name of entries) {
    const sqlPath = path.join(MIGRATIONS_FOLDER, name, "migration.sql");
    if (!fs.existsSync(sqlPath)) continue;
    const content = fs.readFileSync(sqlPath).toString();
    const hash = crypto.createHash("sha256").update(content).digest("hex");
    const createdAt = parseTimestampFromName(name);
    records.push({ name, hash, createdAt, sqlPath });
  }
  return records;
}

function parseTimestampFromName(name: string): number {
  // Format: YYYYMMDDHHMMSS_<slug>
  const stamp = name.slice(0, 14);
  const year = parseInt(stamp.slice(0, 4), 10);
  const month = parseInt(stamp.slice(4, 6), 10) - 1;
  const day = parseInt(stamp.slice(6, 8), 10);
  const hour = parseInt(stamp.slice(8, 10), 10);
  const minute = parseInt(stamp.slice(10, 12), 10);
  const second = parseInt(stamp.slice(12, 14), 10);
  return Date.UTC(year, month, day, hour, minute, second);
}

async function ensureJournalTable(db: any): Promise<void> {
  // Quiet the "already exists" NOTICEs for the idempotent DDL below.
  await db.execute(sql.raw(`SET client_min_messages = 'WARNING'`));
  await db.execute(sql.raw(`CREATE SCHEMA IF NOT EXISTS "drizzle"`));
  await db.execute(
    sql.raw(`CREATE TABLE IF NOT EXISTS "drizzle"."__drizzle_migrations" (
      id SERIAL PRIMARY KEY,
      hash text NOT NULL,
      created_at bigint,
      name text
    )`),
  );
  // Older drizzle installs may have created the table without the `name`
  // column; add it defensively.
  await db.execute(
    sql.raw(`ALTER TABLE "drizzle"."__drizzle_migrations" ADD COLUMN IF NOT EXISTS name text`),
  );
}

async function recordedMigrationNames(db: any): Promise<Set<string>> {
  const rowsRaw = await db.execute(
    sql.raw(`SELECT name FROM "drizzle"."__drizzle_migrations" WHERE name IS NOT NULL`),
  );
  const rows = Array.isArray(rowsRaw) ? rowsRaw : (rowsRaw?.rows ?? []);
  return new Set(rows.map((r: { name: string }) => r.name));
}

async function stampBaselineIfMissing(
  db: any,
  local: MigrationRecord[],
): Promise<boolean> {
  const baseline = local.find((m) => m.name === BASELINE_MIGRATION_NAME);
  if (!baseline) {
    throw new Error(
      `Baseline migration "${BASELINE_MIGRATION_NAME}" not found in ${MIGRATIONS_FOLDER}`,
    );
  }

  const existing = await db.execute(
    sql.raw(
      `SELECT 1 FROM "drizzle"."__drizzle_migrations" WHERE name = '${BASELINE_MIGRATION_NAME}' LIMIT 1`,
    ),
  );

  const rows = Array.isArray(existing) ? existing : (existing?.rows ?? []);
  if (rows.length > 0) return false;

  // Insert the baseline row. Hash uses the file's real sha256 so migrator
  // logic that compares hashes stays consistent.
  await db.execute(
    sql.raw(
      `INSERT INTO "drizzle"."__drizzle_migrations" (hash, created_at, name)
       VALUES ('${baseline.hash}', ${baseline.createdAt}, '${baseline.name}')`,
    ),
  );
  return true;
}

export async function runTenantMigrate(opts: RunTenantMigrateOptions): Promise<void> {
  if (!env.CATALOG_DATABASE_URL) {
    throw new Error("CATALOG_DATABASE_URL is not set");
  }

  const local = loadLocalMigrations();
  if (local.length === 0) {
    throw new Error(`No migrations found in ${MIGRATIONS_FOLDER}`);
  }
  console.log(`Loaded ${local.length} local migrations:`);
  for (const m of local) console.log(`  ${m.name}`);

  const catalog = getCatalogDb(env.CATALOG_DATABASE_URL);
  const orgs = opts.orgId
    ? await catalog
        .select({ id: organization.id, name: organization.name })
        .from(organization)
        .where(eq(organization.id, opts.orgId))
    : opts.all
      ? await catalog
          .select({ id: organization.id, name: organization.name })
          .from(organization)
          .where(eq(organization.status, "active"))
      : [];

  if (orgs.length === 0) {
    console.error("Provide --org=<uuid> or --all");
    process.exit(1);
  }

  const encryptionKey = requireEncryptionKey();
  let failed = 0;

  for (const org of orgs) {
    console.log(`\n=== Org ${org.name} (${org.id}) ===`);
    try {
      const { db } = await getTenantServiceDbByOrgId(
        org.id,
        encryptionKey,
        env.CATALOG_DATABASE_URL,
      );
      await ensureJournalTable(db);
      const stamped = await stampBaselineIfMissing(db, local);
      if (stamped) {
        console.log(`  [stamped] baseline ${BASELINE_MIGRATION_NAME} marked as applied`);
      } else {
        console.log(`  [skip] baseline ${BASELINE_MIGRATION_NAME} already recorded`);
      }

      const before = await recordedMigrationNames(db);
      await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
      const after = await recordedMigrationNames(db);
      const applied = [...after].filter((n) => !before.has(n));

      if (applied.length === 0) {
        console.log("  [ok] no pending migrations");
      } else {
        for (const n of applied) console.log(`  [applied] ${n}`);
      }
      console.log(`  journal now: ${after.size} recorded`);
    } catch (error) {
      failed++;
      console.log(
        `  [error] ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(
    `\nDone. ${orgs.length - failed}/${orgs.length} orgs migrated cleanly.`,
  );
  if (failed > 0) process.exit(2);
}
