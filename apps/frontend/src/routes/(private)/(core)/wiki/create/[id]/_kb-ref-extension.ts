import { Extension } from '@tiptap/core';

import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';

const KB_REGEX = /\bKB\d{3,4}\b/g;
const kbRefKey = new PluginKey('kbRef');

/**
 * TipTap extension that adds inline decorations over KB\d+ references in the
 * editor content. The decorations add `class="kb-ref"` and `data-kb-id` so
 * that the shared KbRefPopover component can handle hover/popover behaviour
 * via event delegation on the editor wrapper.
 */
export const KbRefExtension = Extension.create({
  name: 'kbRef',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: kbRefKey,
        props: {
          decorations(state: any) {
            const decorations: any[] = [];

            state.doc.descendants((node: any, pos: number) => {
              if (!node.isText || !node.text) return;

              KB_REGEX.lastIndex = 0;
              let match: RegExpExecArray | null;
              while ((match = KB_REGEX.exec(node.text)) !== null) {
                const from = pos + match.index;
                const to = from + match[0].length;
                decorations.push(
                  Decoration.inline(from, to, {
                    class: 'kb-ref',
                    'data-kb-id': match[0],
                  })
                );
              }
            });

            return DecorationSet.create(state.doc, decorations);
          },
        },
      }),
    ];
  },
});
