<script lang="ts">
  import type { TipexEditor } from '@friendofsvelte/tipex';
  import { cn } from '$lib/utils';
  import Button from '$lib/components/ui/button/button.svelte';
  import Separator from '$lib/components/ui/separator/separator.svelte';
  import * as Popover from '$lib/components/ui/popover/index.js';
  import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

  import Undo2 from '@lucide/svelte/icons/undo-2';
  import Redo2 from '@lucide/svelte/icons/redo-2';
  import Bold from '@lucide/svelte/icons/bold';
  import Italic from '@lucide/svelte/icons/italic';
  import Underline from '@lucide/svelte/icons/underline';
  import Strikethrough from '@lucide/svelte/icons/strikethrough';
  import RemoveFormatting from '@lucide/svelte/icons/remove-formatting';
  import Baseline from '@lucide/svelte/icons/baseline';
  import Highlighter from '@lucide/svelte/icons/highlighter';
  import AlignLeft from '@lucide/svelte/icons/align-left';
  import AlignCenter from '@lucide/svelte/icons/align-center';
  import AlignRight from '@lucide/svelte/icons/align-right';
  import AlignJustify from '@lucide/svelte/icons/align-justify';
  import List from '@lucide/svelte/icons/list';
  import ListOrdered from '@lucide/svelte/icons/list-ordered';
  import Indent from '@lucide/svelte/icons/indent';
  import Outdent from '@lucide/svelte/icons/outdent';
  import Quote from '@lucide/svelte/icons/quote';
  import Code from '@lucide/svelte/icons/code';
  import MessageSquareQuote from '@lucide/svelte/icons/message-square-quote';
  import type { CalloutVariant } from '../../_wiki-utils.js';

  const { tipex }: { tipex: TipexEditor } = $props();

  // Cast once to avoid repeated casting at call sites
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ed = $derived(tipex as any);

  let fontColorOpen = $state(false);
  let highlightOpen = $state(false);

  const active = $derived(
    (name: string, attrs?: Record<string, unknown>) => tipex?.isActive(name, attrs ?? {}) ?? false
  );
  const can = $derived((cmd: string) => ed?.can()?.[cmd]?.() ?? false);

  const FONT_COLORS: { label: string; value: string }[] = [
    { label: 'Default', value: '' },
    { label: 'Red', value: 'oklch(0.637 0.208 25.33)' },
    { label: 'Orange', value: 'oklch(0.75 0.18 65)' },
    { label: 'Yellow', value: 'oklch(0.84 0.16 95)' },
    { label: 'Green', value: 'oklch(0.72 0.18 148.9)' },
    { label: 'Blue', value: 'oklch(0.62 0.188 259.8)' },
    { label: 'Purple', value: 'oklch(0.58 0.18 290)' },
    { label: 'Pink', value: 'oklch(0.7 0.18 340)' },
    { label: 'Gray', value: 'oklch(0.55 0 0)' },
  ];

  const HIGHLIGHT_COLORS: { label: string; value: string }[] = [
    { label: 'None', value: '' },
    { label: 'Yellow', value: 'oklch(0.84 0.16 95 / 0.35)' },
    { label: 'Green', value: 'oklch(0.72 0.18 148.9 / 0.3)' },
    { label: 'Blue', value: 'oklch(0.62 0.188 259.8 / 0.3)' },
    { label: 'Pink', value: 'oklch(0.7 0.18 340 / 0.3)' },
    { label: 'Orange', value: 'oklch(0.75 0.18 65 / 0.3)' },
    { label: 'Purple', value: 'oklch(0.58 0.18 290 / 0.3)' },
    { label: 'Red', value: 'oklch(0.637 0.208 25.33 / 0.3)' },
    { label: 'Gray', value: 'oklch(0.55 0 0 / 0.3)' },
  ];

  const CALLOUT_VARIANTS: { variant: CalloutVariant; label: string; color: string }[] = [
    { variant: 'blue', label: 'Info', color: 'oklch(0.62 0.188 259.8)' },
    { variant: 'green', label: 'Success', color: 'oklch(0.72 0.18 148.9)' },
    { variant: 'yellow', label: 'Warning', color: 'oklch(0.737 0.153 74.2)' },
    { variant: 'red', label: 'Danger', color: 'oklch(0.637 0.208 25.33)' },
    { variant: 'purple', label: 'Note', color: 'oklch(0.58 0.18 290)' },
    { variant: 'orange', label: 'Tip', color: 'oklch(0.75 0.18 65)' },
  ];

  function btn(isActive: boolean) {
    return cn('size-7', isActive && 'bg-primary/20 text-primary');
  }
</script>

<div
  class="tipex-controller flex items-center flex-wrap gap-0.5 px-2 bg-card/60 backdrop-blur sticky top-0 z-10 max-h-10 border-t"
>
  <!-- Group 1: History -->
  <Button
    class={btn(false)}
    variant="ghost"
    size="icon-sm"
    disabled={!can('undo')}
    onclick={() => ed?.commands.undo()}
    title="Undo (Ctrl+Z)"
  >
    <Undo2 class="size-3.5" />
  </Button>
  <Button
    class={btn(false)}
    variant="ghost"
    size="icon-sm"
    disabled={!can('redo')}
    onclick={() => ed?.commands.redo()}
    title="Redo (Ctrl+Y)"
  >
    <Redo2 class="size-3.5" />
  </Button>

  <Separator orientation="vertical" class="h-5 mx-1" />

  <!-- Group 2: Headings -->
  {#each [1, 2, 3, 4] as level (level)}
    <Button
      class={cn(
        'size-7 text-xs font-bold',
        active('heading', { level }) && 'bg-primary/20 text-primary'
      )}
      variant="ghost"
      size="icon-sm"
      onclick={() => ed?.commands.setHeading({ level })}
      title="Heading {level}"
    >
      H{level}
    </Button>
  {/each}
  <Button
    class={cn('size-7 text-sm', active('paragraph') && 'bg-primary/20 text-primary')}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.setParagraph()}
    title="Paragraph"
  >
    ¶
  </Button>

  <Separator orientation="vertical" class="h-5 mx-1" />

  <!-- Group 3: Inline formatting -->
  <Button
    class={btn(active('bold'))}
    variant="ghost"
    size="icon-sm"
    disabled={!can('toggleBold')}
    onclick={() => ed?.commands.toggleBold()}
    title="Bold (Ctrl+B)"
  >
    <Bold class="size-3.5" />
  </Button>
  <Button
    class={btn(active('italic'))}
    variant="ghost"
    size="icon-sm"
    disabled={!can('toggleItalic')}
    onclick={() => ed?.commands.toggleItalic()}
    title="Italic (Ctrl+I)"
  >
    <Italic class="size-3.5" />
  </Button>
  <Button
    class={btn(active('underline'))}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.toggleUnderline()}
    title="Underline (Ctrl+U)"
  >
    <Underline class="size-3.5" />
  </Button>
  <Button
    class={btn(active('strike'))}
    variant="ghost"
    size="icon-sm"
    disabled={!can('toggleStrike')}
    onclick={() => ed?.commands.toggleStrike()}
    title="Strikethrough"
  >
    <Strikethrough class="size-3.5" />
  </Button>

  <Separator orientation="vertical" class="h-5 mx-1" />

  <!-- Group 4: Color -->
  <Popover.Root bind:open={fontColorOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button class={btn(false)} variant="ghost" size="icon-sm" title="Font Color" {...props}>
          <Baseline class="size-3.5" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="p-2 w-fit" sideOffset={6}>
      <p class="text-xs text-muted-foreground mb-2 px-0.5">Font Color</p>
      <div class="grid grid-cols-5 gap-1">
        {#each FONT_COLORS as color (color.label)}
          <button
            class="size-5 rounded-sm border border-border/60 hover:scale-110 transition-transform cursor-pointer"
            style={color.value
              ? `background-color: ${color.value}`
              : 'background: conic-gradient(#ccc 90deg, #fff 90deg 180deg, #ccc 180deg 270deg, #fff 270deg); background-size: 8px 8px'}
            onclick={() => {
              if (!color.value) ed?.commands.unsetColor();
              else ed?.commands.setColor(color.value);
              fontColorOpen = false;
            }}
            title={color.label}
          ></button>
        {/each}
      </div>
    </Popover.Content>
  </Popover.Root>

  <Popover.Root bind:open={highlightOpen}>
    <Popover.Trigger>
      {#snippet child({ props })}
        <Button
          class={btn(active('highlight'))}
          variant="ghost"
          size="icon-sm"
          title="Highlight"
          {...props}
        >
          <Highlighter class="size-3.5" />
        </Button>
      {/snippet}
    </Popover.Trigger>
    <Popover.Content class="p-2 w-fit" sideOffset={6}>
      <p class="text-xs text-muted-foreground mb-2 px-0.5">Highlight Color</p>
      <div class="grid grid-cols-5 gap-1">
        {#each HIGHLIGHT_COLORS as color (color.label)}
          <button
            class="size-5 rounded-sm border border-border/60 hover:scale-110 transition-transform cursor-pointer"
            style={color.value
              ? `background-color: ${color.value}`
              : 'background: conic-gradient(#ccc 90deg, #fff 90deg 180deg, #ccc 180deg 270deg, #fff 270deg); background-size: 8px 8px'}
            onclick={() => {
              if (!color.value) ed?.commands.unsetHighlight();
              else ed?.commands.setHighlight({ color: color.value });
              highlightOpen = false;
            }}
            title={color.label}
          ></button>
        {/each}
      </div>
    </Popover.Content>
  </Popover.Root>

  <Button
    class={btn(false)}
    variant="ghost"
    size="icon-sm"
    onclick={() => {
      ed?.commands.unsetAllMarks();
      ed?.commands.clearNodes();
    }}
    title="Clear Formatting"
  >
    <RemoveFormatting class="size-3.5" />
  </Button>

  <Separator orientation="vertical" class="h-5 mx-1" />

  <!-- Group 5: Alignment -->
  <Button
    class={btn(
      active('paragraph', { textAlign: 'left' }) || active('heading', { textAlign: 'left' })
    )}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.setTextAlign('left')}
    title="Align Left"
  >
    <AlignLeft class="size-3.5" />
  </Button>
  <Button
    class={btn(
      active('paragraph', { textAlign: 'center' }) || active('heading', { textAlign: 'center' })
    )}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.setTextAlign('center')}
    title="Align Center"
  >
    <AlignCenter class="size-3.5" />
  </Button>
  <Button
    class={btn(
      active('paragraph', { textAlign: 'right' }) || active('heading', { textAlign: 'right' })
    )}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.setTextAlign('right')}
    title="Align Right"
  >
    <AlignRight class="size-3.5" />
  </Button>
  <Button
    class={btn(
      active('paragraph', { textAlign: 'justify' }) || active('heading', { textAlign: 'justify' })
    )}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.setTextAlign('justify')}
    title="Justify"
  >
    <AlignJustify class="size-3.5" />
  </Button>

  <Separator orientation="vertical" class="h-5 mx-1" />

  <!-- Group 6: Lists + Indent -->
  <Button
    class={btn(active('bulletList'))}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.toggleBulletList()}
    title="Bullet List"
  >
    <List class="size-3.5" />
  </Button>
  <Button
    class={btn(active('orderedList'))}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.toggleOrderedList()}
    title="Ordered List"
  >
    <ListOrdered class="size-3.5" />
  </Button>
  <Button
    class={btn(false)}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.sinkListItem('listItem')}
    title="Indent"
  >
    <Indent class="size-3.5" />
  </Button>
  <Button
    class={btn(false)}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.liftListItem('listItem')}
    title="Unindent"
  >
    <Outdent class="size-3.5" />
  </Button>

  <Separator orientation="vertical" class="h-5 mx-1" />

  <!-- Group 7: Blocks -->
  <Button
    class={btn(active('blockquote'))}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.toggleBlockquote()}
    title="Blockquote"
  >
    <Quote class="size-3.5" />
  </Button>
  <Button
    class={btn(active('codeBlock'))}
    variant="ghost"
    size="icon-sm"
    onclick={() => tipex?.chain().focus().toggleCodeBlock().run()}
    title="Code Block"
  >
    <Code class="size-3.5" />
  </Button>

  <!-- Callout dropdown -->
  <DropdownMenu.Root>
    <DropdownMenu.Trigger>
      {#snippet child({ props })}
        <Button
          class={btn(active('callout'))}
          variant="ghost"
          size="icon-sm"
          title="Callout Block"
          {...props}
        >
          <MessageSquareQuote class="size-3.5" />
        </Button>
      {/snippet}
    </DropdownMenu.Trigger>
    <DropdownMenu.Content class="w-40">
      <DropdownMenu.Label class="text-xs">Callout Style</DropdownMenu.Label>
      <DropdownMenu.Separator />
      {#each CALLOUT_VARIANTS as cv (cv.variant)}
        <DropdownMenu.Item
          class={cn(
            'flex items-center gap-2 cursor-pointer',
            active('callout', { variant: cv.variant }) && 'bg-primary/10'
          )}
          onclick={() => ed?.commands.toggleCallout({ variant: cv.variant })}
        >
          <span class="size-2.5 rounded-sm shrink-0" style="background-color: {cv.color}"></span>
          {cv.label}
        </DropdownMenu.Item>
      {/each}
      {#if active('callout')}
        <DropdownMenu.Separator />
        <DropdownMenu.Item
          class="text-muted-foreground cursor-pointer"
          onclick={() => ed?.commands.unsetCallout()}
        >
          Remove callout
        </DropdownMenu.Item>
      {/if}
    </DropdownMenu.Content>
  </DropdownMenu.Root>

  <!-- Table -->
  <!-- <Button
    class={btn(active('table'))}
    variant="ghost"
    size="icon-sm"
    onclick={() => ed?.commands.insertTable({ rows: 3, cols: 3, withHeaderRow: true })}
    title="Insert Table"
  >
    <Table class="size-3.5" />
  </Button> -->
</div>
