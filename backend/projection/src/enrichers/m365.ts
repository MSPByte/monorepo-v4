import {
  m365Groups,
  m365Identities,
  m365IdentityGroups,
  m365IdentityRoles,
  m365Policies,
  m365Roles,
} from "@mspbyte/drizzle";
import { PROVIDER_IDS, ProviderFacet } from "@mspbyte/shared";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type {
  Db,
  ProjectionStep,
  ProjectionStepContext,
} from "../contracts/steps.js";

type ExternalIdRow = { id: string; externalId: string };
type PolicyEnrichmentRow = {
  id: string;
  conditions: unknown;
  grantControls: unknown;
};
type IdentityGroupMembershipRow = {
  identityId: string;
  groupExternalId: string;
};
type IdentityRoleMembershipRow = {
  identityId: string;
  roleTemplateId: string;
};

const MFA_TRIGGER_FACETS = new Set<string>([
  ProviderFacet.M365Identities,
  ProviderFacet.M365Groups,
  ProviderFacet.M365CAPolicies,
]);

const CAPolicyUsersSchema = z.looseObject({
  includeUsers: z.array(z.string()).optional().default([]),
  excludeUsers: z.array(z.string()).optional().default([]),
  includeGroups: z.array(z.string()).optional().default([]),
  excludeGroups: z.array(z.string()).optional().default([]),
  includeRoles: z.array(z.string()).optional().default([]),
  excludeRoles: z.array(z.string()).optional().default([]),
});

const CAPolicyConditionsSchema = z.looseObject({
  users: CAPolicyUsersSchema.optional().nullable(),
  applications: z
    .looseObject({
      includeApplications: z.array(z.string()).optional().default([]),
    })
    .optional()
    .nullable(),
});

const CAPolicyGrantControlsSchema = z
  .looseObject({
    builtInControls: z.array(z.string()).optional().nullable(),
  })
  .optional()
  .nullable();

export const m365Enrichers: readonly ProjectionStep[] = [
  {
    id: "m365.identity-mfa",
    kind: "enrich",
    provider: PROVIDER_IDS.M365,
    triggerFacets: MFA_TRIGGER_FACETS,
    requiredFacets: [
      ProviderFacet.M365Identities,
      ProviderFacet.M365Groups,
      ProviderFacet.M365CAPolicies,
    ],
    run: enrichM365Mfa,
  },
];

async function enrichM365Mfa(
  context: ProjectionStepContext,
): Promise<Record<string, unknown>> {
  const [policyDocs, identityDocs] = (await Promise.all([
    activeMfaCandidatePolicies(context.db, context.linkId),
    activeIdentities(context.db, context.linkId),
  ])) as [PolicyEnrichmentRow[], ExternalIdRow[]];

  const mfaPolicies = policyDocs
    .filter((policy) => {
      const grantControls = CAPolicyGrantControlsSchema.safeParse(
        policy.grantControls,
      );
      if (
        !grantControls.success ||
        !grantControls.data?.builtInControls?.includes("mfa")
      ) {
        return false;
      }

      const conditions = CAPolicyConditionsSchema.safeParse(policy.conditions);
      return (
        conditions.data?.applications?.includeApplications?.includes("All") ??
        false
      );
    })
    .map((policy) => CAPolicyConditionsSchema.parse(policy.conditions));

  if (identityDocs.length === 0) {
    return { identitiesEnriched: 0, mfaEnforced: 0 };
  }

  if (mfaPolicies.length === 0) {
    await updateIdentityMfaInChunks(
      context.db,
      identityDocs.map((identity) => identity.id),
      false,
    );
    return {
      identitiesEnriched: identityDocs.length,
      mfaEnforced: 0,
      mfaPolicies: 0,
    };
  }

  const [identityGroupRows, identityRoleRows] = (await Promise.all([
    identityGroupMemberships(context.db, context.linkId),
    identityRoleMemberships(context.db, context.linkId),
  ])) as [IdentityGroupMembershipRow[], IdentityRoleMembershipRow[]];

  const groupsByIdentityId = new Map<string, Set<string>>();
  for (const row of identityGroupRows) {
    const existing =
      groupsByIdentityId.get(row.identityId) ?? new Set<string>();
    existing.add(row.groupExternalId);
    groupsByIdentityId.set(row.identityId, existing);
  }

  const rolesByIdentityId = new Map<string, Set<string>>();
  for (const row of identityRoleRows) {
    const existing = rolesByIdentityId.get(row.identityId) ?? new Set<string>();
    existing.add(row.roleTemplateId);
    rolesByIdentityId.set(row.identityId, existing);
  }

  const trueIds: string[] = [];
  const falseIds: string[] = [];

  for (const identity of identityDocs) {
    const groupExternalIds =
      groupsByIdentityId.get(identity.id) ?? new Set<string>();
    const roleTemplateIds =
      rolesByIdentityId.get(identity.id) ?? new Set<string>();
    const mfaEnforced = mfaPolicies.some((conditions) => {
      const users = conditions.users;
      if (!users) return false;

      const included =
        users.includeUsers.includes("All") ||
        users.includeUsers.includes(identity.externalId) ||
        users.includeGroups.some((groupId) => groupExternalIds.has(groupId)) ||
        users.includeRoles.some((roleId) => roleTemplateIds.has(roleId));

      const excluded =
        users.excludeUsers.includes(identity.externalId) ||
        users.excludeGroups.some((groupId) => groupExternalIds.has(groupId)) ||
        users.excludeRoles.some((roleId) => roleTemplateIds.has(roleId));

      return included && !excluded;
    });

    if (mfaEnforced) trueIds.push(identity.id);
    else falseIds.push(identity.id);
  }

  await Promise.all([
    updateIdentityMfaInChunks(context.db, trueIds, true),
    updateIdentityMfaInChunks(context.db, falseIds, false),
  ]);

  return {
    identitiesEnriched: identityDocs.length,
    mfaEnforced: trueIds.length,
    mfaPolicies: mfaPolicies.length,
  };
}

async function activeMfaCandidatePolicies(
  db: Db,
  linkId: string,
): Promise<PolicyEnrichmentRow[]> {
  return db
    .select({
      id: m365Policies.id,
      conditions: m365Policies.conditions,
      grantControls: m365Policies.grantControls,
    })
    .from(m365Policies)
    .where(
      and(
        eq(m365Policies.linkId, linkId),
        eq(m365Policies.policyState, "enabled"),
        isNull(m365Policies.deletedAt),
      ),
    );
}

async function activeIdentities(
  db: Db,
  linkId: string,
): Promise<ExternalIdRow[]> {
  return db
    .select({ id: m365Identities.id, externalId: m365Identities.externalId })
    .from(m365Identities)
    .where(
      and(eq(m365Identities.linkId, linkId), isNull(m365Identities.deletedAt)),
    );
}

async function identityGroupMemberships(
  db: Db,
  linkId: string,
): Promise<IdentityGroupMembershipRow[]> {
  return db
    .select({
      identityId: m365IdentityGroups.identityId,
      groupExternalId: m365Groups.externalId,
    })
    .from(m365IdentityGroups)
    .innerJoin(m365Groups, eq(m365IdentityGroups.groupId, m365Groups.id))
    .where(eq(m365IdentityGroups.linkId, linkId));
}

async function identityRoleMemberships(
  db: Db,
  linkId: string,
): Promise<IdentityRoleMembershipRow[]> {
  return db
    .select({
      identityId: m365IdentityRoles.identityId,
      roleTemplateId: m365Roles.templateId,
    })
    .from(m365IdentityRoles)
    .innerJoin(m365Roles, eq(m365IdentityRoles.roleId, m365Roles.id))
    .where(eq(m365IdentityRoles.linkId, linkId));
}

async function updateIdentityMfaInChunks(
  db: Db,
  ids: string[],
  mfaEnforced: boolean,
): Promise<void> {
  const chunkSize = 1_000;
  for (let index = 0; index < ids.length; index += chunkSize) {
    const chunk = ids.slice(index, index + chunkSize);
    if (chunk.length === 0) continue;
    await db
      .update(m365Identities)
      .set({ mfaEnforced })
      .where(inArray(m365Identities.id, chunk));
  }
}
