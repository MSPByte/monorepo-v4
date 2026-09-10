<script lang="ts">
  import { formatRelativeDate, prettyText } from '$lib/utils/format';
  import { severityLabel } from '$lib/utils/label';
  import PolicyActionsMenu from './policy-actions-menu.svelte';

  type Props = {
    id: string;
    name: string;
    description?: string | null;
    category?: string | null;
    scope: string;
    dataSource?: string | null;
    origin?: string | null;
    enabled: boolean;
    severity: number;
    openFindingCount: number | null;
    frameworkCount: number;
    assignmentCount: number;
    lastEvaluation?: string | null;
    updatedAt?: string | null;
  };
  let {
    id,
    name,
    description,
    category,
    scope,
    dataSource,
    origin,
    enabled,
    severity,
    openFindingCount,
    frameworkCount,
    assignmentCount,
    lastEvaluation,
    updatedAt,
  }: Props = $props();

</script>

<header class="pw-detail-heading">
  <a class="pw-back" href="/policies">← All policies</a>
  <div class="pw-heading">
    <div><div class="pw-eyebrow">{category ? prettyText(category) : 'Operational'} policy</div><h1>{name}</h1>
      {#if description}<p class="pw-description">{description}</p>{/if}
    </div>
    <PolicyActionsMenu policyId={id} policyName={name} />
  </div>
  <div class="pw-pills"><span class:pw-enabled={enabled}>{enabled ? 'Enabled' : 'Disabled'}</span><span>{severityLabel(severity)} severity</span><span>{prettyText(scope)}</span>{#if dataSource}<span>{dataSource}</span>{/if}</div>
  <div class="pw-overview">
    <a href={`/findings?policyId=${id}`}><strong class:text-destructive={(openFindingCount ?? 0) > 0}>{openFindingCount?.toLocaleString() ?? '—'}</strong><span>Open findings ↗</span></a>
    <a href="#assignments"><strong>{assignmentCount}</strong><span>Direct assignments ↓</span></a>
    <a href="#frameworks"><strong>{frameworkCount}</strong><span>Frameworks ↓</span></a>
    <div><span>Last updated</span><strong class="pw-date">{lastEvaluation ? formatRelativeDate(lastEvaluation) : 'Not available'}</strong></div>
  </div>
</header>
