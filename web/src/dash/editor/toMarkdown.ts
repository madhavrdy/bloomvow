// Visual editor HTML -> Markdown, so posts keep being stored (and rendered on the site) as
// Markdown exactly as before. Covers what the editor can make: headings, bold, italic,
// strikethrough, links, images, lists, quotes, code, tables, dividers and line breaks.
import TurndownService from 'turndown';
// @ts-expect-error no type declarations for this small plugin
import { gfm } from 'turndown-plugin-gfm';

let td: TurndownService | null = null;
function service(): TurndownService {
  if (td) return td;
  td = new TurndownService({
    headingStyle: 'atx', bulletListMarker: '-', codeBlockStyle: 'fenced', emDelimiter: '*', strongDelimiter: '**',
    hr: '---', linkStyle: 'inlined', blankReplacement: (_c, node) => ((node as HTMLElement).nodeName === 'P' ? '\n\n' : ''),
  });
  td.use(gfm);
  // "- item" and "1. item" (Turndown's default pads markers to four characters).
  td.addRule('listItem', {
    filter: 'li',
    replacement: (content, node) => {
      const parent = node.parentNode as HTMLElement;
      let prefix = '- ';
      if (parent?.nodeName === 'OL') {
        const start = Number(parent.getAttribute('start') || 1);
        prefix = `${start + Array.prototype.indexOf.call(parent.children, node)}. `;
      }
      const body = content.replace(/^\n+/, '').replace(/\n+$/, '').replace(/\n(?=.)/g, `\n${' '.repeat(prefix.length)}`);
      return `${prefix}${body}\n`;
    },
  });
  td.addRule('strike', { filter: ['del', 's'], replacement: (c) => (c.trim() ? `~~${c}~~` : '') });
  // Table cells hold <p> in the editor; keep each cell on one line.
  td.addRule('cellParagraph', {
    filter: (n) => n.nodeName === 'P' && /^(TD|TH)$/.test(n.parentNode?.nodeName ?? ''),
    replacement: (c, n) => (n.previousSibling ? ` ${c.trim()}` : c.trim()),
  });
  td.addRule('image', {
    filter: 'img',
    replacement: (_c, n) => {
      const el = n as HTMLImageElement;
      const src = el.getAttribute('src') ?? '';
      const alt = (el.getAttribute('alt') ?? '').replace(/[\[\]]/g, '');
      return src ? `![${alt}](${src})` : '';
    },
  });
  td.remove(['script', 'style']);
  return td;
}

export function htmlToMarkdown(html: string): string {
  // The editor adds <colgroup> and inline widths to tables; without them the GFM table
  // converter sees a plain header row and writes a proper | table |.
  const clean = (html || '').replace(/<colgroup>[\s\S]*?<\/colgroup>/gi, '').replace(/<table[^>]*>/gi, '<table>');
  const md = service().turndown(clean);
  if (!md.trim()) return '';
  return md.replace(/^[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').replace(/[ \t]+$/gm, (m) => (m.length >= 2 ? '  ' : '')).trim() + '\n';
}
