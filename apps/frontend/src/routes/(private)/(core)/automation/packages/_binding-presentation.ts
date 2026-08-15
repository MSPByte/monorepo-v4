export type Source =
  | 'fixed'
  | 'runtime'
  | 'row'
  | 'wire'
  | 'failure'
  | 'template'
  | 'generated'
  | 'fact';

type BindingLike =
  | { kind: 'literal' }
  | { kind: 'runtime' }
  | { kind: 'priorOutput' }
  | { kind: 'failureContext' }
  | { kind: 'template' }
  | { kind: 'generated' }
  | { kind: 'siteFact' }
  | { kind: 'entity'; source: 'row-context' | 'picker' };

export function sourceOf(binding: BindingLike | undefined): Source {
  if (!binding || binding.kind === 'literal') return 'fixed';
  if (binding.kind === 'runtime') return 'runtime';
  if (binding.kind === 'priorOutput') return 'wire';
  if (binding.kind === 'failureContext') return 'failure';
  if (binding.kind === 'template') return 'template';
  if (binding.kind === 'generated') return 'generated';
  if (binding.kind === 'siteFact') return 'fact';
  return binding.source === 'row-context' ? 'row' : 'runtime';
}

export function sourceLabel(source: Source): string {
  return {
    fixed: 'Fixed value',
    runtime: 'Ask when run',
    row: 'From triggering row',
    wire: 'Wire from step',
    failure: 'From failure',
    template: 'Template',
    generated: 'Generate',
    fact: 'From site fact',
  }[source];
}

export function sourceHint(
  source: Source,
  meta: { entityType?: string; typeHint?: string } | undefined
): string {
  if (source === 'fixed') return 'Same value every run.';
  if (source === 'runtime')
    return meta?.entityType
      ? 'The operator picks from a live list when they start the run.'
      : 'The operator enters this when they start the run.';
  if (source === 'row')
    return 'Auto-filled from the row that triggered this package (from a table row-action).';
  if (source === 'generated') return 'Produced by a generator at run time.';
  if (source === 'fact')
    return "Reads a value from the run's site profile facts — needs a site selected at run time.";
  if (source === 'failure')
    return 'Reads a single value from the failure context — for free-form text mixing multiple values, use Template instead.';
  if (source === 'template')
    return 'Write free-form text with {{variable}} placeholders — mix failure details, step outputs, and site facts into one string.';
  return 'Reads a specific output from an earlier step in this package.';
}

export function sourceIconColor(source: Source): string {
  return {
    fixed: 'text-stone-500 dark:text-stone-400',
    runtime: 'text-amber-600 dark:text-amber-400',
    row: 'text-violet-600 dark:text-violet-400',
    generated: 'text-emerald-600 dark:text-emerald-400',
    fact: 'text-fuchsia-600 dark:text-fuchsia-400',
    failure: 'text-rose-600 dark:text-rose-400',
    template: 'text-blue-600 dark:text-blue-400',
    wire: 'text-cyan-600 dark:text-cyan-400',
  }[source];
}

export function sourceBorderClass(source: Source): string {
  return {
    fixed: 'border-l-stone-400/60 dark:border-l-stone-500/60',
    runtime: 'border-l-amber-500/70',
    row: 'border-l-violet-500/70',
    generated: 'border-l-emerald-500/70',
    fact: 'border-l-fuchsia-500/70',
    failure: 'border-l-rose-500/70',
    template: 'border-l-blue-500/70',
    wire: 'border-l-cyan-500/70',
  }[source];
}

export function inputTypeLabel(meta: { fieldTypeLabel?: string }): string {
  return meta.fieldTypeLabel ?? 'Text';
}
