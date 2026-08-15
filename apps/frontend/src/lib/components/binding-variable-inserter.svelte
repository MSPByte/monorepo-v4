<script lang="ts">
  import { Braces } from '@lucide/svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as Command from '$lib/components/ui/command/index.js';

  type Step = { capabilityId: string; label?: string };
  type Prompt = { id: string; label: string };
  type SiteFactField = { key: string; label: string; section: string };
  type CapInfo = { name: string; outputMeta: Record<string, { label?: string }> };

  let {
    lane,
    mainSteps = [],
    laneSteps = [],
    prompts = [],
    siteFactFields = [],
    capIndex,
    target,
    value = $bindable<string>(''),
    oninsert,
  }: {
    lane: 'main' | 'onSuccess' | 'onFailure';
    mainSteps?: Step[];
    laneSteps?: Step[];
    prompts?: Prompt[];
    siteFactFields?: SiteFactField[];
    capIndex: Map<string, CapInfo>;
    target: HTMLTextAreaElement | null;
    value: string;
    oninsert?: (newValue: string) => void;
  } = $props();

  let open = $state(false);

  function insertTag(path: string) {
    const tag = `{{${path}}}`;
    const at = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? at;
    const newValue = value.slice(0, at) + tag + value.slice(end);
    value = newValue;
    oninsert?.(newValue);
    open = false;
    requestAnimationFrame(() => {
      if (!target) return;
      target.focus();
      const pos = at + tag.length;
      target.setSelectionRange(pos, pos);
    });
  }

  const groups = $derived.by(() => {
    const out: Array<{ heading: string; tags: Array<{ label: string; path: string }> }> = [];

    if (lane === 'onFailure') {
      out.push({
        heading: 'Failure context',
        tags: [
          { label: 'Error message',      path: 'failure.message' },
          { label: 'Failed capability',  path: 'failure.capabilityName' },
          { label: 'Error class',        path: 'failure.errorClass' },
          { label: 'Failed step number', path: 'failure.stepPosition' },
          { label: 'Run status',         path: 'failure.status' },
          { label: 'Run ID',             path: 'failure.runId' },
          { label: 'Site ID',            path: 'failure.siteId' },
        ],
      });
    }

    for (let i = 0; i < mainSteps.length; i++) {
      const step = mainSteps[i]!;
      const cap = capIndex.get(step.capabilityId);
      if (!cap) continue;
      const tags = Object.entries(cap.outputMeta).map(([key, m]) => ({
        label: m.label ?? key,
        path: `step.${i}.${key}`,
      }));
      if (tags.length > 0) {
        out.push({ heading: `Step ${String(i + 1).padStart(2, '0')} · ${step.label ?? cap.name}`, tags });
      }
    }

    for (let i = 0; i < laneSteps.length; i++) {
      const step = laneSteps[i]!;
      const cap = capIndex.get(step.capabilityId);
      if (!cap) continue;
      const lanePrefix = lane === 'onSuccess' ? 'on-success' : 'on-failure';
      const tags = Object.entries(cap.outputMeta).map(([key, m]) => ({
        label: m.label ?? key,
        path: `${lanePrefix}.${i}.${key}`,
      }));
      if (tags.length > 0) {
        out.push({ heading: `${lane === 'onSuccess' ? 'On success' : 'On failure'} · Step ${String(i + 1).padStart(2, '0')} · ${step.label ?? cap.name}`, tags });
      }
    }

    if (prompts.length > 0) {
      out.push({
        heading: 'Prompts',
        tags: prompts.map((p) => ({ label: p.label, path: `prompt.${p.id}` })),
      });
    }

    if (siteFactFields.length > 0) {
      out.push({
        heading: 'Site facts',
        tags: siteFactFields.map((f) => ({ label: `${f.label} (${f.section})`, path: `fact.${f.key}` })),
      });
    }

    return out;
  });

  const hasAny = $derived(groups.some((g) => g.tags.length > 0));
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="sm" type="button" class="h-6 gap-1 px-2 text-xs" disabled={!hasAny}>
        <Braces class="size-3" />
        Insert variable
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-72 p-0" align="end">
    <Command.Root>
      <Command.Input placeholder="Search variables…" />
      <Command.Empty>No variables available for this context.</Command.Empty>
      <Command.List class="max-h-72 overflow-auto">
        {#each groups as group (group.heading)}
          {#if group.tags.length}
            <Command.Group heading={group.heading}>
              {#each group.tags as tag (tag.path)}
                <Command.Item
                  value={`${group.heading} ${tag.label} ${tag.path}`}
                  onSelect={() => insertTag(tag.path)}
                >
                  <div class="flex flex-col gap-0.5">
                    <span class="text-sm">{tag.label}</span>
                    <span class="font-mono text-xs text-muted-foreground">{`{{${tag.path}}}`}</span>
                  </div>
                </Command.Item>
              {/each}
            </Command.Group>
          {/if}
        {/each}
      </Command.List>
    </Command.Root>
  </Popover.Content>
</Popover.Root>
