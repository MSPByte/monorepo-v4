<script lang="ts">
  import { Tipex, defaultExtensions } from '@friendofsvelte/tipex';
  import { TextStyle } from '@tiptap/extension-text-style';
  import { TextAlign } from '@tiptap/extension-text-align';
  import { Color } from '@tiptap/extension-color';
  import { Highlight } from '@tiptap/extension-highlight';
  import { Table } from '@tiptap/extension-table';
  import { TableRow } from '@tiptap/extension-table-row';
  import { TableHeader } from '@tiptap/extension-table-header';
  import { TableCell } from '@tiptap/extension-table-cell';

  import Toolbar from './create/[id]/_toolbar.svelte';
  import { CalloutExtension } from './create/[id]/_callout-extension.js';
  import { KbRefExtension } from './create/[id]/_kb-ref-extension.js';
  import KbRefPopover from './_kb-ref-popover.svelte';

  let {
    initialHtml = '<p></p>',
    html = $bindable('<p></p>'),
    json = $bindable<Record<string, unknown> | undefined>(undefined),
    text = $bindable(''),
    class: className = '',
    onchange = () => {},
  } = $props<{
    initialHtml?: string;
    html?: string;
    json?: Record<string, unknown>;
    text?: string;
    class?: string;
    onchange?: () => void;
  }>();

  const extensions = [
    ...defaultExtensions,
    TextStyle,
    TextAlign.configure({ types: ['heading', 'paragraph'] }),
    Color,
    Highlight.configure({ multicolor: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableHeader,
    TableCell,
    CalloutExtension,
    KbRefExtension,
  ];
</script>

<KbRefPopover>
  <Tipex
    body={initialHtml}
    {extensions}
    class={className}
    onupdate={({ editor }) => {
      html = editor.getHTML();
      json = editor.getJSON() as Record<string, unknown>;
      text = editor.getText();
      onchange();
    }}
  >
    {#snippet controlComponent(tipex)}
      <Toolbar {tipex} />
    {/snippet}
  </Tipex>
</KbRefPopover>
