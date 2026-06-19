export interface ArticleOutlineItem {
  id: string;
  level: 1 | 2 | 3 | 4;
  text: string;
}

interface TiptapNode {
  type?: string;
  text?: string;
  attrs?: {
    level?: number;
  };
  content?: TiptapNode[];
}

function getNodeText(node: TiptapNode): string {
  if (node.text) return node.text;
  return node.content?.map(getNodeText).join('') ?? '';
}

function slugify(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

  return slug || 'section';
}

export function extractArticleOutline(json: unknown): ArticleOutlineItem[] {
  const used = new Map<string, number>();
  const headings: ArticleOutlineItem[] = [];

  function visit(node: TiptapNode) {
    if (node.type === 'heading') {
      const level = node.attrs?.level;
      const text = getNodeText(node).trim();

      if (text && level && level >= 1 && level <= 4) {
        const baseId = slugify(text);
        const count = used.get(baseId) ?? 0;
        used.set(baseId, count + 1);

        headings.push({
          id: count === 0 ? baseId : `${baseId}-${count + 1}`,
          level: level as ArticleOutlineItem['level'],
          text,
        });
      }
    }

    for (const child of node.content ?? []) {
      visit(child);
    }
  }

  if (json && typeof json === 'object') {
    visit(json as TiptapNode);
  }

  return headings;
}

export function applyArticleHeadingIds(container: HTMLElement | null, outline: ArticleOutlineItem[]) {
  if (!container) return;

  const headings = Array.from(container.querySelectorAll('h1, h2, h3, h4'));
  headings.forEach((heading, index) => {
    const item = outline[index];
    if (!item) return;

    heading.id = item.id;
  });
}
