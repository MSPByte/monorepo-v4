<script lang="ts">
  import { Braces } from '@lucide/svelte';
  import Button from '$lib/components/ui/button/button.svelte';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as Command from '$lib/components/ui/command/index.js';

  type Tag = { label: string; ingestPath: string };
  type TagGroup = { heading: string; tags: Tag[] };

  let {
    groups,
    target,
    value = $bindable<string>(''),
    label = 'Insert tag',
  }: {
    groups: TagGroup[];
    target: HTMLInputElement | HTMLTextAreaElement | null;
    value: string;
    label?: string;
  } = $props();

  let open = $state(false);

  function insertTag(path: string) {
    const tag = `{{${path}}}`;
    const at = target?.selectionStart ?? value.length;
    const end = target?.selectionEnd ?? at;
    value = value.slice(0, at) + tag + value.slice(end);
    open = false;
    requestAnimationFrame(() => {
      if (!target) return;
      target.focus();
      const pos = at + tag.length;
      target.setSelectionRange(pos, pos);
    });
  }
</script>

<Popover.Root bind:open>
  <Popover.Trigger>
    {#snippet child({ props })}
      <Button {...props} variant="ghost" size="sm" type="button" class="h-6 gap-1 px-2 text-xs">
        <Braces class="size-3" />
        {label}
      </Button>
    {/snippet}
  </Popover.Trigger>
  <Popover.Content class="w-72 p-0" align="end">
    <Command.Root>
      <Command.Input placeholder="Search fields..." />
      <Command.Empty>No fields available</Command.Empty>
      <Command.List class="max-h-72 overflow-auto">
        {#each groups as group (group.heading)}
          {#if group.tags.length}
            <Command.Group heading={group.heading}>
              {#each group.tags as tag (tag.ingestPath)}
                <Command.Item
                  value={`${group.heading} ${tag.label} ${tag.ingestPath}`}
                  onSelect={() => insertTag(tag.ingestPath)}
                >
                  <div class="flex flex-col gap-0.5">
                    <span class="text-sm">{tag.label}</span>
                    <span class="text-xs text-muted-foreground">{`{{${tag.ingestPath}}}`}</span>
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
