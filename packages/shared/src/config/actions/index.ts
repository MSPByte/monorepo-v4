export enum ActionLabels {
  SophosEndpointDelete = 'sophos.endpoint.delete',
  SophosEndpointTamperEnable = 'sophos.endpoint.tamper_protection.enable',
  SophosEndpointTamperDisable = 'sophos.endpoint.tamper_protection.disable',
  SophosEndpointTamperSet = 'sophos.endpoint.tamper_protection.set',
  SophosEndpointUpgrade = 'sophos.endpoint.upgrade',
  SophosEndpointMigrate = 'sophos.endpoint.migrate',
  PolicyCreate = 'policy.create',
  PolicyUpdate = 'policy.update',
  PolicyDelete = 'policy.delete',
  PolicySetFrameworkMembership = 'policy.set_framework_membership',
  FindingSuppress = 'finding.suppress',
  FindingUnsuppress = 'finding.unsuppress',
  FindingResolve = 'finding.resolve',
  SiteCreate = 'site.create',
  SiteRename = 'site.rename',
  SiteDelete = 'site.delete',
  SiteGroupCreate = 'site_group.create',
  SiteGroupUpdate = 'site_group.update',
  SiteGroupDelete = 'site_group.delete',
  SiteGroupMemberAdd = 'site_group.member.add',
  SiteGroupMemberRemove = 'site_group.member.remove',
  SiteProfileFactCreate = 'site_profile.fact.create',
  SiteProfileFactUpdate = 'site_profile.fact.update',
  SiteProfileFactDelete = 'site_profile.fact.delete',
  SiteProfileStackUpdate = 'site_profile.stack.update',
  SiteProfileNoteCreate = 'site_profile.note.create',
  SiteProfileNoteUpdate = 'site_profile.note.update',
  SiteProfileNoteDelete = 'site_profile.note.delete',
  SiteProfileFieldCreate = 'site_profile.field.create',
  SiteProfileFieldUpdate = 'site_profile.field.update',
  SiteProfileFieldDelete = 'site_profile.field.delete',
  SiteProfileCategoryCreate = 'site_profile.category.create',
  SiteProfileCategoryUpdate = 'site_profile.category.update',
  SiteProfileCategoryDelete = 'site_profile.category.delete',
  EntitySourceLink = 'entity_source.link',
  EntitySourceUnlink = 'entity_source.unlink',
  EntitySourceConfirm = 'entity_source.confirm',
  EntitySourceReject = 'entity_source.reject',
  RoleCreate = 'role.create',
  RoleUpdate = 'role.update',
  RoleDelete = 'role.delete',
  UserCreate = 'user.create',
  UserDelete = 'user.delete',
  UserGrantAdd = 'user.grant.add',
  UserGrantRemove = 'user.grant.remove',
  FrameworkCreate = 'framework.create',
  FrameworkUpdate = 'framework.update',
  FrameworkDelete = 'framework.delete',
  FrameworkSetPolicies = 'framework.set_policies',
  PolicyAssignmentCreate = 'policy_assignment.create',
  PolicyAssignmentDelete = 'policy_assignment.delete',
  BillingRuleCreate = 'billing.rule.create',
  BillingRuleUpdate = 'billing.rule.update',
  BillingRuleDelete = 'billing.rule.delete',
  IntegrationConfigure = 'integration.configure',
  IntegrationDelete = 'integration.delete',
  IntegrationLinkCreate = 'integration_link.create',
  IntegrationLinkUpdate = 'integration_link.update',
  IntegrationLinkSaveBatch = 'integration_link.save_batch',
  IntegrationLinkDelete = 'integration_link.delete',
  WikiContextCreate = 'wiki.context.create',
  WikiContextUpdate = 'wiki.context.update',
  WikiContextDelete = 'wiki.context.delete',
  WikiTagCreate = 'wiki.tag.create',
  WikiTagUpdate = 'wiki.tag.update',
  WikiTagDelete = 'wiki.tag.delete',
  WikiArticleCreate = 'wiki.article.create',
  WikiArticleUpdate = 'wiki.article.update',
  WikiArticleUpdateMeta = 'wiki.article.update_meta',
  WikiArticleArchive = 'wiki.article.archive',
  WikiArticleDelete = 'wiki.article.delete',
  WikiArticlePublish = 'wiki.article.publish',
  WikiDraftDiscard = 'wiki.draft.discard',
  WikiOverrideCreate = 'wiki.override.create',
  WikiOverrideUpdate = 'wiki.override.update',
  WikiOverrideDelete = 'wiki.override.delete',
  MspAgentDelete = 'mspagent.agent.delete',
  M365IdentityRevokeSessions = 'm365.identity.revoke_sessions',
  M365IdentityDisable = 'm365.identity.disable',
  M365IdentityEnable = 'm365.identity.enable',
  M365IdentityForcePasswordChange = 'm365.identity.force_password_change',
  M365IdentityResetPassword = 'm365.identity.reset_password',
  M365IdentityRequireMfaReset = 'm365.identity.require_mfa_reset',
  M365IdentityDeleteAuthMethod = 'm365.identity.delete_auth_method',
  M365GroupCreate = 'm365.group.create',
  M365IdentityGroupAdd = 'm365.identity.group.add',
  M365IdentityGroupRemove = 'm365.identity.group.remove',
  M365ConditionalAccessPolicyCreate = 'm365.conditional_access.policy.create',
  M365IdentityLicenseAdd = 'm365.identity.license.add',
  M365IdentityLicenseRemove = 'm365.identity.license.remove',
  M365IdentityRoleAdd = 'm365.identity.role.add',
  M365IdentityRoleRemove = 'm365.identity.role.remove',
  PackageCreate = 'package.create',
  PackageUpdate = 'package.update',
  PackageDelete = 'package.delete',
  PackageRunStart = 'package.run.start',
  PackageRunRevealOutput = 'package.run.reveal_output',
  PackageScheduleCreate = 'package.schedule.create',
  PackageScheduleUpdate = 'package.schedule.update',
  PackageScheduleCancel = 'package.schedule.cancel',
  PackageScheduleDelete = 'package.schedule.delete',
  SophosPartnerSiteCreate = 'sophos_partner.site.create',
  DattoSiteCreate = 'datto.site.create',
  CoveSiteCreate = 'cove.site.create',
  CoreSiteProvision = 'core.site.provision',
  CoreHaloPSATicketCreate = 'core.halopsa.ticket.create'
}

export type ActionLabel = `${ActionLabels}`;

export type ActionResource = {
  label: ActionLabel;
  name: string;
};

export const ActionResources = {
  [ActionLabels.SophosEndpointDelete]: {
    label: ActionLabels.SophosEndpointDelete,
    name: 'Sophos endpoint delete'
  },
  [ActionLabels.SophosEndpointTamperEnable]: {
    label: ActionLabels.SophosEndpointTamperEnable,
    name: 'Sophos endpoint enable tamper protection'
  },
  [ActionLabels.SophosEndpointTamperDisable]: {
    label: ActionLabels.SophosEndpointTamperDisable,
    name: 'Sophos endpoint disable tamper protection'
  },
  [ActionLabels.SophosEndpointTamperSet]: {
    label: ActionLabels.SophosEndpointTamperSet,
    name: 'Sophos endpoint set tamper protection'
  },
  [ActionLabels.SophosEndpointUpgrade]: {
    label: ActionLabels.SophosEndpointUpgrade,
    name: 'Sophos endpoint upgrade'
  },
  [ActionLabels.SophosEndpointMigrate]: {
    label: ActionLabels.SophosEndpointMigrate,
    name: 'Sophos endpoint migrate to site'
  },
  [ActionLabels.PolicyCreate]: {
    label: ActionLabels.PolicyCreate,
    name: 'Policy create'
  },
  [ActionLabels.PolicyUpdate]: {
    label: ActionLabels.PolicyUpdate,
    name: 'Policy update'
  },
  [ActionLabels.PolicyDelete]: {
    label: ActionLabels.PolicyDelete,
    name: 'Policy delete'
  },
  [ActionLabels.PolicySetFrameworkMembership]: {
    label: ActionLabels.PolicySetFrameworkMembership,
    name: 'Policy set framework membership'
  },
  [ActionLabels.FindingSuppress]: {
    label: ActionLabels.FindingSuppress,
    name: 'Finding suppress'
  },
  [ActionLabels.FindingUnsuppress]: {
    label: ActionLabels.FindingUnsuppress,
    name: 'Finding unsuppress'
  },
  [ActionLabels.FindingResolve]: {
    label: ActionLabels.FindingResolve,
    name: 'Finding resolve'
  },
  [ActionLabels.SiteCreate]: {
    label: ActionLabels.SiteCreate,
    name: 'Site create'
  },
  [ActionLabels.SiteRename]: {
    label: ActionLabels.SiteRename,
    name: 'Site rename'
  },
  [ActionLabels.SiteDelete]: {
    label: ActionLabels.SiteDelete,
    name: 'Site delete'
  },
  [ActionLabels.SiteGroupCreate]: {
    label: ActionLabels.SiteGroupCreate,
    name: 'Site group create'
  },
  [ActionLabels.SiteGroupUpdate]: {
    label: ActionLabels.SiteGroupUpdate,
    name: 'Site group update'
  },
  [ActionLabels.SiteGroupDelete]: {
    label: ActionLabels.SiteGroupDelete,
    name: 'Site group delete'
  },
  [ActionLabels.SiteGroupMemberAdd]: {
    label: ActionLabels.SiteGroupMemberAdd,
    name: 'Site group member add'
  },
  [ActionLabels.SiteGroupMemberRemove]: {
    label: ActionLabels.SiteGroupMemberRemove,
    name: 'Site group member remove'
  },
  [ActionLabels.SiteProfileFactCreate]: {
    label: ActionLabels.SiteProfileFactCreate,
    name: 'Site profile fact create'
  },
  [ActionLabels.SiteProfileFactUpdate]: {
    label: ActionLabels.SiteProfileFactUpdate,
    name: 'Site profile fact update'
  },
  [ActionLabels.SiteProfileFactDelete]: {
    label: ActionLabels.SiteProfileFactDelete,
    name: 'Site profile fact delete'
  },
  [ActionLabels.SiteProfileStackUpdate]: {
    label: ActionLabels.SiteProfileStackUpdate,
    name: 'Site profile stack update'
  },
  [ActionLabels.SiteProfileNoteCreate]: {
    label: ActionLabels.SiteProfileNoteCreate,
    name: 'Site profile note create'
  },
  [ActionLabels.SiteProfileNoteUpdate]: {
    label: ActionLabels.SiteProfileNoteUpdate,
    name: 'Site profile note update'
  },
  [ActionLabels.SiteProfileNoteDelete]: {
    label: ActionLabels.SiteProfileNoteDelete,
    name: 'Site profile note delete'
  },
  [ActionLabels.SiteProfileFieldCreate]: {
    label: ActionLabels.SiteProfileFieldCreate,
    name: 'Site profile field create'
  },
  [ActionLabels.SiteProfileFieldUpdate]: {
    label: ActionLabels.SiteProfileFieldUpdate,
    name: 'Site profile field update'
  },
  [ActionLabels.SiteProfileFieldDelete]: {
    label: ActionLabels.SiteProfileFieldDelete,
    name: 'Site profile field delete'
  },
  [ActionLabels.SiteProfileCategoryCreate]: {
    label: ActionLabels.SiteProfileCategoryCreate,
    name: 'Site profile category create'
  },
  [ActionLabels.SiteProfileCategoryUpdate]: {
    label: ActionLabels.SiteProfileCategoryUpdate,
    name: 'Site profile category update'
  },
  [ActionLabels.SiteProfileCategoryDelete]: {
    label: ActionLabels.SiteProfileCategoryDelete,
    name: 'Site profile category delete'
  },
  [ActionLabels.EntitySourceLink]: {
    label: ActionLabels.EntitySourceLink,
    name: 'Entity source link'
  },
  [ActionLabels.EntitySourceUnlink]: {
    label: ActionLabels.EntitySourceUnlink,
    name: 'Entity source unlink'
  },
  [ActionLabels.EntitySourceConfirm]: {
    label: ActionLabels.EntitySourceConfirm,
    name: 'Entity source confirm'
  },
  [ActionLabels.EntitySourceReject]: {
    label: ActionLabels.EntitySourceReject,
    name: 'Entity source reject'
  },
  [ActionLabels.RoleCreate]: {
    label: ActionLabels.RoleCreate,
    name: 'Role create'
  },
  [ActionLabels.RoleUpdate]: {
    label: ActionLabels.RoleUpdate,
    name: 'Role update'
  },
  [ActionLabels.RoleDelete]: {
    label: ActionLabels.RoleDelete,
    name: 'Role delete'
  },
  [ActionLabels.UserCreate]: {
    label: ActionLabels.UserCreate,
    name: 'User create'
  },
  [ActionLabels.UserDelete]: {
    label: ActionLabels.UserDelete,
    name: 'User delete'
  },
  [ActionLabels.UserGrantAdd]: {
    label: ActionLabels.UserGrantAdd,
    name: 'User grant add'
  },
  [ActionLabels.UserGrantRemove]: {
    label: ActionLabels.UserGrantRemove,
    name: 'User grant remove'
  },
  [ActionLabels.FrameworkCreate]: {
    label: ActionLabels.FrameworkCreate,
    name: 'Framework create'
  },
  [ActionLabels.FrameworkUpdate]: {
    label: ActionLabels.FrameworkUpdate,
    name: 'Framework update'
  },
  [ActionLabels.FrameworkDelete]: {
    label: ActionLabels.FrameworkDelete,
    name: 'Framework delete'
  },
  [ActionLabels.FrameworkSetPolicies]: {
    label: ActionLabels.FrameworkSetPolicies,
    name: 'Framework set policies'
  },
  [ActionLabels.PolicyAssignmentCreate]: {
    label: ActionLabels.PolicyAssignmentCreate,
    name: 'Policy assignment create'
  },
  [ActionLabels.PolicyAssignmentDelete]: {
    label: ActionLabels.PolicyAssignmentDelete,
    name: 'Policy assignment delete'
  },
  [ActionLabels.BillingRuleCreate]: {
    label: ActionLabels.BillingRuleCreate,
    name: 'Billing rule create'
  },
  [ActionLabels.BillingRuleUpdate]: {
    label: ActionLabels.BillingRuleUpdate,
    name: 'Billing rule update'
  },
  [ActionLabels.BillingRuleDelete]: {
    label: ActionLabels.BillingRuleDelete,
    name: 'Billing rule delete'
  },
  [ActionLabels.IntegrationConfigure]: {
    label: ActionLabels.IntegrationConfigure,
    name: 'Integration configure'
  },
  [ActionLabels.IntegrationDelete]: {
    label: ActionLabels.IntegrationDelete,
    name: 'Integration delete'
  },
  [ActionLabels.IntegrationLinkCreate]: {
    label: ActionLabels.IntegrationLinkCreate,
    name: 'Integration link create'
  },
  [ActionLabels.IntegrationLinkUpdate]: {
    label: ActionLabels.IntegrationLinkUpdate,
    name: 'Integration link update'
  },
  [ActionLabels.IntegrationLinkSaveBatch]: {
    label: ActionLabels.IntegrationLinkSaveBatch,
    name: 'Integration link save batch'
  },
  [ActionLabels.IntegrationLinkDelete]: {
    label: ActionLabels.IntegrationLinkDelete,
    name: 'Integration link delete'
  },
  [ActionLabels.WikiContextCreate]: {
    label: ActionLabels.WikiContextCreate,
    name: 'Wiki context create'
  },
  [ActionLabels.WikiContextUpdate]: {
    label: ActionLabels.WikiContextUpdate,
    name: 'Wiki context update'
  },
  [ActionLabels.WikiContextDelete]: {
    label: ActionLabels.WikiContextDelete,
    name: 'Wiki context delete'
  },
  [ActionLabels.WikiTagCreate]: {
    label: ActionLabels.WikiTagCreate,
    name: 'Wiki tag create'
  },
  [ActionLabels.WikiTagUpdate]: {
    label: ActionLabels.WikiTagUpdate,
    name: 'Wiki tag update'
  },
  [ActionLabels.WikiTagDelete]: {
    label: ActionLabels.WikiTagDelete,
    name: 'Wiki tag delete'
  },
  [ActionLabels.WikiArticleCreate]: {
    label: ActionLabels.WikiArticleCreate,
    name: 'Wiki article create'
  },
  [ActionLabels.WikiArticleUpdate]: {
    label: ActionLabels.WikiArticleUpdate,
    name: 'Wiki article update'
  },
  [ActionLabels.WikiArticleUpdateMeta]: {
    label: ActionLabels.WikiArticleUpdateMeta,
    name: 'Wiki article update meta'
  },
  [ActionLabels.WikiArticleArchive]: {
    label: ActionLabels.WikiArticleArchive,
    name: 'Wiki article archive'
  },
  [ActionLabels.WikiArticleDelete]: {
    label: ActionLabels.WikiArticleDelete,
    name: 'Wiki article delete'
  },
  [ActionLabels.WikiArticlePublish]: {
    label: ActionLabels.WikiArticlePublish,
    name: 'Wiki article publish'
  },
  [ActionLabels.WikiDraftDiscard]: {
    label: ActionLabels.WikiDraftDiscard,
    name: 'Wiki draft discard'
  },
  [ActionLabels.WikiOverrideCreate]: {
    label: ActionLabels.WikiOverrideCreate,
    name: 'Wiki override create'
  },
  [ActionLabels.WikiOverrideUpdate]: {
    label: ActionLabels.WikiOverrideUpdate,
    name: 'Wiki override update'
  },
  [ActionLabels.WikiOverrideDelete]: {
    label: ActionLabels.WikiOverrideDelete,
    name: 'Wiki override delete'
  },
  [ActionLabels.MspAgentDelete]: {
    label: ActionLabels.MspAgentDelete,
    name: 'MSPAgent delete'
  },
  [ActionLabels.M365IdentityRevokeSessions]: {
    label: ActionLabels.M365IdentityRevokeSessions,
    name: 'M365 identity revoke sessions'
  },
  [ActionLabels.M365IdentityDisable]: {
    label: ActionLabels.M365IdentityDisable,
    name: 'M365 identity disable'
  },
  [ActionLabels.M365IdentityEnable]: {
    label: ActionLabels.M365IdentityEnable,
    name: 'M365 identity enable'
  },
  [ActionLabels.M365IdentityForcePasswordChange]: {
    label: ActionLabels.M365IdentityForcePasswordChange,
    name: 'M365 identity force password change'
  },
  [ActionLabels.M365IdentityResetPassword]: {
    label: ActionLabels.M365IdentityResetPassword,
    name: 'M365 identity reset password'
  },
  [ActionLabels.M365IdentityRequireMfaReset]: {
    label: ActionLabels.M365IdentityRequireMfaReset,
    name: 'M365 identity require MFA reset'
  },
  [ActionLabels.M365IdentityDeleteAuthMethod]: {
    label: ActionLabels.M365IdentityDeleteAuthMethod,
    name: 'M365 identity delete auth method'
  },
  [ActionLabels.M365GroupCreate]: {
    label: ActionLabels.M365GroupCreate,
    name: 'M365 group create'
  },
  [ActionLabels.M365IdentityGroupAdd]: {
    label: ActionLabels.M365IdentityGroupAdd,
    name: 'M365 identity add to group'
  },
  [ActionLabels.M365ConditionalAccessPolicyCreate]: {
    label: ActionLabels.M365ConditionalAccessPolicyCreate,
    name: 'M365 conditional access policy create'
  },
  [ActionLabels.M365IdentityGroupRemove]: {
    label: ActionLabels.M365IdentityGroupRemove,
    name: 'M365 identity remove from group'
  },
  [ActionLabels.M365IdentityLicenseAdd]: {
    label: ActionLabels.M365IdentityLicenseAdd,
    name: 'M365 identity assign license'
  },
  [ActionLabels.M365IdentityLicenseRemove]: {
    label: ActionLabels.M365IdentityLicenseRemove,
    name: 'M365 identity remove license'
  },
  [ActionLabels.M365IdentityRoleAdd]: {
    label: ActionLabels.M365IdentityRoleAdd,
    name: 'M365 identity assign role'
  },
  [ActionLabels.M365IdentityRoleRemove]: {
    label: ActionLabels.M365IdentityRoleRemove,
    name: 'M365 identity remove role'
  },
  [ActionLabels.PackageCreate]: {
    label: ActionLabels.PackageCreate,
    name: 'Package create'
  },
  [ActionLabels.PackageUpdate]: {
    label: ActionLabels.PackageUpdate,
    name: 'Package update'
  },
  [ActionLabels.PackageDelete]: {
    label: ActionLabels.PackageDelete,
    name: 'Package delete'
  },
  [ActionLabels.PackageRunStart]: {
    label: ActionLabels.PackageRunStart,
    name: 'Package run start'
  },
  [ActionLabels.PackageRunRevealOutput]: {
    label: ActionLabels.PackageRunRevealOutput,
    name: 'Package run reveal output'
  },
  [ActionLabels.PackageScheduleCreate]: {
    label: ActionLabels.PackageScheduleCreate,
    name: 'Package schedule create'
  },
  [ActionLabels.PackageScheduleUpdate]: {
    label: ActionLabels.PackageScheduleUpdate,
    name: 'Package schedule update'
  },
  [ActionLabels.PackageScheduleCancel]: {
    label: ActionLabels.PackageScheduleCancel,
    name: 'Package schedule cancel'
  },
  [ActionLabels.PackageScheduleDelete]: {
    label: ActionLabels.PackageScheduleDelete,
    name: 'Package schedule delete'
  },
  [ActionLabels.SophosPartnerSiteCreate]: {
    label: ActionLabels.SophosPartnerSiteCreate,
    name: 'Sophos Partner create site'
  },
  [ActionLabels.DattoSiteCreate]: {
    label: ActionLabels.DattoSiteCreate,
    name: 'Datto create site'
  },
  [ActionLabels.CoveSiteCreate]: {
    label: ActionLabels.CoveSiteCreate,
    name: 'Cove create site'
  },
  [ActionLabels.CoreSiteProvision]: {
    label: ActionLabels.CoreSiteProvision,
    name: 'Provision MSPByte site'
  },
  [ActionLabels.CoreHaloPSATicketCreate]: {
    label: ActionLabels.CoreHaloPSATicketCreate,
    name: 'Create HaloPSA ticket'
  }
} satisfies Record<ActionLabel, ActionResource>;

export const ActionFilterOptions = Object.values(ActionLabels).map((actionLabel) => ({
  label: ActionResources[actionLabel].name,
  value: actionLabel
}));

export function getActionResource(actionLabel: string | null | undefined) {
  if (!actionLabel) return null;
  return ActionResources[actionLabel as ActionLabel];
}

export function formatActionLabel(actionLabel: string | null | undefined, fallback?: string) {
  return getActionResource(actionLabel)?.name ?? fallback ?? actionLabel ?? 'Unknown action';
}
