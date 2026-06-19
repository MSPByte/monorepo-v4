import { generateHTML as _generateHTML } from '@tiptap/html';
import { StarterKit } from '@tiptap/starter-kit';
import { Link } from '@tiptap/extension-link';
import { Image } from '@tiptap/extension-image';
import { Underline } from '@tiptap/extension-underline';
import { TaskList } from '@tiptap/extension-task-list';
import { TaskItem } from '@tiptap/extension-task-item';
import { TextStyle } from '@tiptap/extension-text-style';
import { TextAlign } from '@tiptap/extension-text-align';
import { Color } from '@tiptap/extension-color';
import { Highlight } from '@tiptap/extension-highlight';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableHeader } from '@tiptap/extension-table-header';
import { TableCell } from '@tiptap/extension-table-cell';
import { CalloutExtension } from './create/[id]/_callout-extension.js';
import type { JSONContent } from '@tiptap/core';

const extensions = [
  StarterKit,
  Link.configure({ openOnClick: false }),
  Image.configure({ allowBase64: true }),
  Underline,
  TaskList,
  TaskItem.configure({ nested: true }),
  TextStyle,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  Color,
  Highlight.configure({ multicolor: true }),
  Table.configure({ resizable: false }),
  TableRow,
  TableHeader,
  TableCell,
  CalloutExtension,
];

export function generateHTML(json: JSONContent): string {
  return _generateHTML(json, extensions);
}

export function renderContentHtml(json: JSONContent): string {
  return _generateHTML(json, extensions);
}
