import { Node } from '@tiptap/core';
import type { CalloutVariant } from '../../_wiki-utils.js';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    callout: {
      setCallout: (attrs: { variant: CalloutVariant }) => ReturnType;
      toggleCallout: (attrs: { variant: CalloutVariant }) => ReturnType;
      unsetCallout: () => ReturnType;
    };
  }
}

export const CalloutExtension = Node.create({
  name: 'callout',

  group: 'block',

  content: 'block+',

  defining: true,

  addAttributes() {
    return {
      variant: {
        default: 'blue' as CalloutVariant,
        parseHTML: (element) => (element.getAttribute('data-callout-variant') as CalloutVariant) ?? 'blue',
        renderHTML: (attributes) => ({
          'data-callout-variant': attributes.variant,
        }),
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-callout]',
        getAttrs: (node) => ({
          variant: (node as HTMLElement).getAttribute('data-callout-variant') ?? 'blue',
        }),
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-callout': '', ...HTMLAttributes }, 0];
  },

  addCommands() {
    return {
      setCallout:
        (attributes) =>
        ({ commands }) => {
          return commands.wrapIn(this.name, attributes);
        },
      toggleCallout:
        (attributes) =>
        ({ commands }) => {
          return commands.toggleWrap(this.name, attributes);
        },
      unsetCallout:
        () =>
        ({ commands }) => {
          return commands.lift(this.name);
        },
    };
  },

  addKeyboardShortcuts() {
    return {
      'Mod-Shift-c': () => this.editor.commands.toggleCallout({ variant: 'blue' }),
    };
  },
});
