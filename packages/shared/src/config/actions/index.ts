export enum ActionLabels {
  SophosEndpointDelete = 'sophos.endpoint.delete',
  SophosEndpointTamperEnable = 'sophos.endpoint.tamper_protection.enable'
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
