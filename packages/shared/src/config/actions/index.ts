export enum ActionLabels {
  SophosEndpointDelete = 'sophos.endpoint.delete',
  SophosEndpointTamperEnable = 'sophos.endpoint.tamper_protection.enable',
  PolicyDelete = 'policy.delete',
  FindingSuppress = 'finding.suppress',
  FindingUnsuppress = 'finding.unsuppress',
  SiteRename = 'site.rename',
  SiteDelete = 'site.delete',
  SiteProfileFactCreate = 'site_profile.fact.create',
  SiteProfileFactUpdate = 'site_profile.fact.update',
  SiteProfileFactDelete = 'site_profile.fact.delete',
  SiteProfileStackUpdate = 'site_profile.stack.update',
  SiteProfileNoteCreate = 'site_profile.note.create',
  SiteProfileNoteUpdate = 'site_profile.note.update',
  SiteProfileNoteDelete = 'site_profile.note.delete'
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
  [ActionLabels.PolicyDelete]: {
    label: ActionLabels.PolicyDelete,
    name: 'Policy delete'
  },
  [ActionLabels.FindingSuppress]: {
    label: ActionLabels.FindingSuppress,
    name: 'Finding suppress'
  },
  [ActionLabels.FindingUnsuppress]: {
    label: ActionLabels.FindingUnsuppress,
    name: 'Finding unsuppress'
  },
  [ActionLabels.SiteRename]: {
    label: ActionLabels.SiteRename,
    name: 'Site rename'
  },
  [ActionLabels.SiteDelete]: {
    label: ActionLabels.SiteDelete,
    name: 'Site delete'
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
