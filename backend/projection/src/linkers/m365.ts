import {
  m365Groups,
  m365Identities,
  m365IdentityGroups,
  m365Policies,
  m365PolicyGroups,
  m365PolicyIdentities,
  m365PolicyRoles,
  m365Roles,
} from "@mspbyte/drizzle";
import { PROVIDER_IDS, ProviderFacet } from "@mspbyte/shared";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import type {
  Db,
  ProjectionStep,
  ProjectionStepContext,
} from "../contracts/steps.js";

type ExternalIdRow = { id: string; externalId: string };
type GroupRow = ExternalIdRow & { memberExternalIds: string[] | null };
type RoleRow = { id: string; templateId: string };
type PolicyConditionsRow = { id: string; conditions: unknown };

const MEMBERSHIP_TRIGGER_FACETS = new Set<string>([
  ProviderFacet.M365Identities,
  ProviderFacet.M365Groups,
]);

const POLICY_LINK_TRIGGER_FACETS = new Set<string>([
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
});

export const m365Linkers: readonly ProjectionStep[] = [
  {
    id: "m365.membership-links",
    kind: "link",
    provider: PROVIDER_IDS.M365,
    triggerFacets: MEMBERSHIP_TRIGGER_FACETS,
    requiredFacets: [ProviderFacet.M365Identities, ProviderFacet.M365Groups],
    run: linkM365Membership,
  },
  {
    id: "m365.policy-target-links",
    kind: "link",
    provider: PROVIDER_IDS.M365,
    triggerFacets: POLICY_LINK_TRIGGER_FACETS,
    requiredFacets: [
      ProviderFacet.M365Identities,
      ProviderFacet.M365Groups,
      ProviderFacet.M365CAPolicies,
    ],
    run: linkM365Policies,
  },
];

async function linkM365Membership(
  context: ProjectionStepContext,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const [identityDocs, groupDocs] = (await Promise.all([
    activeIdentities(context.db, context.linkId),
    activeGroups(context.db, context.linkId),
  ])) as [ExternalIdRow[], GroupRow[]];

  const identityByExternalId = new Map(
    identityDocs.map((identity) => [identity.externalId, identity.id]),
  );
  const identityGroupRows: Array<typeof m365IdentityGroups.$inferInsert> = [];
  const identityGroupKeys = new Set<string>();
  const groupsMissingMembershipSource = groupDocs.filter(
    (group) => !Array.isArray(group.memberExternalIds),
  );
  if (groupsMissingMembershipSource.length > 0) {
    return {
      skipped: true,
      reason: "missing_group_membership_source",
      groups: groupDocs.length,
      groupsMissingMembershipSource: groupsMissingMembershipSource.length,
    };
  }

  for (const group of groupDocs) {
    const memberExternalIds = group.memberExternalIds;
    if (!Array.isArray(memberExternalIds)) continue;
    for (const memberExternalId of memberExternalIds) {
      const identityId = identityByExternalId.get(memberExternalId);
      if (!identityId) continue;
      const key = `${identityId}:${group.id}`;
      if (identityGroupKeys.has(key)) continue;
      identityGroupKeys.add(key);
      identityGroupRows.push({
        identityId,
        groupId: group.id,
        linkId: context.linkId,
        lastSeenAt: now,
        createdAt: now,
      });
    }
  }

  await context.db
    .delete(m365IdentityGroups)
    .where(eq(m365IdentityGroups.linkId, context.linkId));
  await insertInChunks(context.db, m365IdentityGroups, identityGroupRows);

  return {
    identities: identityDocs.length,
    groups: groupDocs.length,
    identityGroups: identityGroupRows.length,
  };
}

async function linkM365Policies(
  context: ProjectionStepContext,
): Promise<Record<string, unknown>> {
  const now = new Date().toISOString();
  const [identityDocs, groupDocs, roleDocs, policyDocs] = (await Promise.all([
    activeIdentities(context.db, context.linkId),
    activeGroups(context.db, context.linkId),
    roles(context.db),
    activePolicies(context.db, context.linkId),
  ])) as [ExternalIdRow[], GroupRow[], RoleRow[], PolicyConditionsRow[]];

  const identityByExternalId = new Map(
    identityDocs.map((identity) => [identity.externalId, identity.id]),
  );
  const groupByExternalId = new Map(
    groupDocs.map((group) => [group.externalId, group.id]),
  );
  const roleByTemplateId = new Map(
    roleDocs.map((role) => [role.templateId, role.id]),
  );
  const policyIdentityRows: Array<typeof m365PolicyIdentities.$inferInsert> =
    [];
  const policyGroupRows: Array<typeof m365PolicyGroups.$inferInsert> = [];
  const policyRoleRows: Array<typeof m365PolicyRoles.$inferInsert> = [];
  const policyIdentityKeys = new Set<string>();
  const policyGroupKeys = new Set<string>();
  const policyRoleKeys = new Set<string>();

  for (const policy of policyDocs) {
    const parsed = CAPolicyConditionsSchema.safeParse(policy.conditions);
    const users = parsed.data?.users;
    if (!users) continue;

    for (const userExternalId of users.includeUsers) {
      if (userExternalId === "All") continue;
      const identityId = identityByExternalId.get(userExternalId);
      if (!identityId) continue;
      const key = `${policy.id}:${identityId}:true`;
      if (policyIdentityKeys.has(key)) continue;
      policyIdentityKeys.add(key);
      policyIdentityRows.push({
        policyId: policy.id,
        identityId,
        linkId: context.linkId,
        included: true,
        lastSeenAt: now,
        createdAt: now,
      });
    }

    for (const userExternalId of users.excludeUsers) {
      const identityId = identityByExternalId.get(userExternalId);
      if (!identityId) continue;
      const key = `${policy.id}:${identityId}:false`;
      if (policyIdentityKeys.has(key)) continue;
      policyIdentityKeys.add(key);
      policyIdentityRows.push({
        policyId: policy.id,
        identityId,
        linkId: context.linkId,
        included: false,
        lastSeenAt: now,
        createdAt: now,
      });
    }

    for (const groupExternalId of users.includeGroups) {
      const groupId = groupByExternalId.get(groupExternalId);
      if (!groupId) continue;
      const key = `${policy.id}:${groupId}:true`;
      if (policyGroupKeys.has(key)) continue;
      policyGroupKeys.add(key);
      policyGroupRows.push({
        policyId: policy.id,
        groupId,
        linkId: context.linkId,
        included: true,
        lastSeenAt: now,
        createdAt: now,
      });
    }

    for (const groupExternalId of users.excludeGroups) {
      const groupId = groupByExternalId.get(groupExternalId);
      if (!groupId) continue;
      const key = `${policy.id}:${groupId}:false`;
      if (policyGroupKeys.has(key)) continue;
      policyGroupKeys.add(key);
      policyGroupRows.push({
        policyId: policy.id,
        groupId,
        linkId: context.linkId,
        included: false,
        lastSeenAt: now,
        createdAt: now,
      });
    }

    for (const roleTemplateId of users.includeRoles) {
      const roleId = roleByTemplateId.get(roleTemplateId);
      if (!roleId) continue;
      const key = `${policy.id}:${roleId}:true`;
      if (policyRoleKeys.has(key)) continue;
      policyRoleKeys.add(key);
      policyRoleRows.push({
        policyId: policy.id,
        roleId,
        linkId: context.linkId,
        included: true,
        lastSeenAt: now,
        createdAt: now,
      });
    }

    for (const roleTemplateId of users.excludeRoles) {
      const roleId = roleByTemplateId.get(roleTemplateId);
      if (!roleId) continue;
      const key = `${policy.id}:${roleId}:false`;
      if (policyRoleKeys.has(key)) continue;
      policyRoleKeys.add(key);
      policyRoleRows.push({
        policyId: policy.id,
        roleId,
        linkId: context.linkId,
        included: false,
        lastSeenAt: now,
        createdAt: now,
      });
    }
  }

  await Promise.all([
    context.db
      .delete(m365PolicyIdentities)
      .where(eq(m365PolicyIdentities.linkId, context.linkId)),
    context.db
      .delete(m365PolicyGroups)
      .where(eq(m365PolicyGroups.linkId, context.linkId)),
    context.db
      .delete(m365PolicyRoles)
      .where(eq(m365PolicyRoles.linkId, context.linkId)),
  ]);
  await Promise.all([
    insertInChunks(context.db, m365PolicyIdentities, policyIdentityRows),
    insertInChunks(context.db, m365PolicyGroups, policyGroupRows),
    insertInChunks(context.db, m365PolicyRoles, policyRoleRows),
  ]);

  return {
    policies: policyDocs.length,
    policyIdentities: policyIdentityRows.length,
    policyGroups: policyGroupRows.length,
    policyRoles: policyRoleRows.length,
  };
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

async function activeGroups(db: Db, linkId: string): Promise<GroupRow[]> {
  return db
    .select({
      id: m365Groups.id,
      externalId: m365Groups.externalId,
      memberExternalIds: m365Groups.memberExternalIds,
    })
    .from(m365Groups)
    .where(and(eq(m365Groups.linkId, linkId), isNull(m365Groups.deletedAt)));
}

async function activePolicies(
  db: Db,
  linkId: string,
): Promise<PolicyConditionsRow[]> {
  return db
    .select({ id: m365Policies.id, conditions: m365Policies.conditions })
    .from(m365Policies)
    .where(
      and(eq(m365Policies.linkId, linkId), isNull(m365Policies.deletedAt)),
    );
}

async function roles(db: Db): Promise<RoleRow[]> {
  return db
    .select({ id: m365Roles.id, templateId: m365Roles.templateId })
    .from(m365Roles);
}

async function insertInChunks<T extends Record<string, unknown>>(
  db: Db,
  table: unknown,
  rows: T[],
): Promise<void> {
  const chunkSize = 1_000;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    if (chunk.length > 0) await db.insert(table).values(chunk);
  }
}
