import { eq } from "drizzle-orm";
import { packages } from "@mspbyte/drizzle";
import type { SeedContext, SeedReport } from "./index.js";

type SeededPackage = {
  name: string;
  description: string;
  status: "active";
  version: number;
  steps: Array<{
    capabilityId: string;
    label: string;
    inputBindings: Record<string, unknown>;
  }>;
};

// Demonstrates the Phase 1 single-step path.
const RESET_PASSWORD_PACKAGE: SeededPackage = {
  name: "Reset M365 Password",
  description:
    "Reset a Microsoft 365 identity's password. Generates a random password and requires the user to change it at next sign-in.",
  status: "active",
  version: 1,
  steps: [
    {
      capabilityId: "m365.identity.reset-password",
      label: "Reset password",
      inputBindings: {
        identityId: { kind: "runtime", promptKey: "identityId", required: true },
        mode: { kind: "literal", value: "random" },
        forceChangeAtNextSignin: { kind: "literal", value: true },
      },
    },
  ],
};

// Demonstrates the Phase 2 multi-step + priorOutput wiring: create-user →
// assign-license, with the created userId flowing into the second step.
const CREATE_ADMIN_PACKAGE: SeededPackage = {
  name: "Create Admin + Assign License",
  description:
    "Create an M365 user in a chosen tenant and assign licenses in one shot. Demonstrates prior-output wiring.",
  status: "active",
  version: 1,
  steps: [
    {
      capabilityId: "m365.identity.create",
      label: "Create user",
      inputBindings: {
        tenantLinkId: { kind: "runtime", promptKey: "tenantLinkId", required: true },
        displayName: { kind: "runtime", promptKey: "displayName", required: true },
        userPrincipalName: {
          kind: "runtime",
          promptKey: "userPrincipalName",
          required: true,
        },
        mailNickname: {
          kind: "runtime",
          promptKey: "mailNickname",
          required: true,
        },
        initialPassword: {
          kind: "runtime",
          promptKey: "initialPassword",
          required: true,
        },
        forceChangeAtNextSignin: { kind: "literal", value: true },
      },
    },
    {
      capabilityId: "m365.license.assign",
      label: "Assign licenses",
      inputBindings: {
        tenantLinkId: { kind: "runtime", promptKey: "tenantLinkId", required: true },
        identityExternalId: { kind: "priorOutput", stepPosition: 0, path: "userId" },
        skuIds: { kind: "runtime", promptKey: "skuIds", required: true },
        removeSkuIds: { kind: "literal", value: [] },
      },
    },
  ],
};

const ALL: SeededPackage[] = [RESET_PASSWORD_PACKAGE, CREATE_ADMIN_PACKAGE];

export async function seedPackagesCatalog(ctx: SeedContext): Promise<SeedReport> {
  const db = ctx.tenantDb as any;
  let inserted = 0;
  let updated = 0;
  let unchanged = 0;

  for (const pkg of ALL) {
    const existing = await db
      .select({
        id: packages.id,
        version: packages.version,
        status: packages.status,
        steps: packages.steps,
        description: packages.description,
      })
      .from(packages)
      .where(eq(packages.name, pkg.name))
      .limit(1);

    if (existing.length === 0) {
      await db.insert(packages).values({
        name: pkg.name,
        description: pkg.description,
        status: pkg.status,
        version: pkg.version,
        steps: pkg.steps,
      });
      inserted++;
      continue;
    }

    const current = existing[0]!;
    const stepsMatch =
      JSON.stringify(current.steps) === JSON.stringify(pkg.steps) &&
      current.description === pkg.description &&
      current.status === pkg.status;

    if (stepsMatch) {
      unchanged++;
      continue;
    }

    await db
      .update(packages)
      .set({
        description: pkg.description,
        status: pkg.status,
        version: current.version + 1,
        steps: pkg.steps,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(packages.id, current.id));
    updated++;
  }

  const status = inserted + updated > 0 ? "applied" : "unchanged";
  return {
    seed: "packages-catalog",
    status,
    details: `Packages catalog: ${inserted} inserted, ${updated} updated, ${unchanged} unchanged`,
    metrics: { inserted, updated, unchanged },
  };
}
