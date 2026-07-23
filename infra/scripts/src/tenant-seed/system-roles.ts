import { eq } from "drizzle-orm";
import { roles } from "@mspbyte/drizzle";
import { SYSTEM_ROLES } from "@mspbyte/shared";
import type { SeedContext, SeedReport } from "./index.js";

/**
 * Reconciles the tenant's `roles` table against SYSTEM_ROLES in @mspbyte/shared.
 * Upserts by name — never deletes unknown rows (a renamed or custom role a
 * customer relies on must not disappear). Only the fields we manage are
 * overwritten; created_at is preserved.
 */
export async function seedSystemRoles(ctx: SeedContext): Promise<SeedReport> {
  const db = ctx.tenantDb as any;

  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const role of SYSTEM_ROLES) {
    const permissions = [...role.permissions];

    const existing = await db
      .select({
        description: roles.description,
        level: roles.level,
        permissions: roles.permissions,
        isSystem: roles.isSystem,
      })
      .from(roles)
      .where(eq(roles.name, role.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(roles).values({
        name: role.name,
        description: role.description,
        level: role.level,
        permissions,
        isSystem: true,
      });
      inserted++;
      continue;
    }

    const current = existing[0];
    const diffs =
      current.description !== role.description ||
      current.level !== role.level ||
      !arraysEqual(current.permissions ?? [], permissions) ||
      current.isSystem !== true;

    if (!diffs) {
      unchanged++;
      continue;
    }

    await db
      .update(roles)
      .set({
        description: role.description,
        level: role.level,
        permissions,
        isSystem: true,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(roles.name, role.name));
    updated++;
  }

  const total = SYSTEM_ROLES.length;
  const details = `${inserted} inserted, ${updated} updated, ${unchanged} unchanged (of ${total})`;
  const status: SeedReport["status"] =
    inserted + updated === 0 ? "unchanged" : "applied";

  return {
    seed: "system-roles",
    status,
    details,
    metrics: { inserted, updated, unchanged, total },
  };
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
