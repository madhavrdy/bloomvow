// Visual (WYSIWYG) editor for blog posts. Posts are still stored as Markdown: the editor
// opens the Markdown as formatted text and hands Markdown back on every change, so the
// public site renders posts exactly as before. Pasting from Google Docs or Word keeps
// headings, bold/italic, links, lists and tables and drops their fonts and colours.
import { useEffect, useRef, useState } from 'preact/hooks';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import { Placeholder } from '@tiptap/extensions';
import { renderMarkdown } from '../../lib/markdown';
import { htmlToMarkdown } from './toMarkdown';

type Props = {
  value: string;                                   // Markdown
  onChange: (markdown: string) => void;
  /** Uploads an image and returns its public URL (or throws with a friendly message). */
  onUpload?: (file: File) => Promise<string>;
  placeholder?: string;
};

const BLOCKS = [
  ['p', 'Paragraph'], ['h2', 'Heading'], ['h3', 'Subheading'], ['h4', 'Small heading'],
] as const;

export function RichEditor({ value, onChange, onUpload, placeholder = 'Start writing…' }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const ed = useRef<Editor | null>(null);
  const fileIn = useRef<HTMLInputElement>(null);
  const [, tick] = useState(0);
  const [linkOpen, setLinkOpen] = useState(false);
  const [href, setHref] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const changed = useRef(onChange);
  changed.current = onChange;

  useEffect(() => {
    const editor = new Editor({
      element: host.current!,
      extensions: [
        StarterKit.configure({
          heading: { levels: [2, 3, 4] },
          underline: false,                          // no underline in Markdown; it reads as a link anyway
          link: { openOnClick: false, autolink: true, defaultProtocol: 'https',
            HTMLAttributes: { target: null, rel: null } },
        }),
        Image.configure({ inline: false, allowBase64: false }),
        TableKit.configure({ table: { resizable: false } }),
        Placeholder.configure({ placeholder }),
      ],
      // Markdown puts each image in its own paragraph; the editor's images are blocks, so
      // unwrap them (otherwise every image opens with an empty line above it).
      content: renderMarkdown(value).html.replace(/<p>\s*(<img[^>]*>)\s*<\/p>/g, '$1'),
      editorProps: {
        attributes: { class: 'rte-body', role: 'textbox', 'aria-multiline': 'true', 'aria-label': 'Post body' },
        handlePaste: (_view, ev) => {
          const files = [...(ev.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'));
          if (!files.length || !onUpload) return false;
          ev.preventDefault(); void addImages(files); return true;
        },
        handleDrop: (_view, ev) => {
          const files = [...((ev as DragEvent).dataTransfer?.files ?? [])].filter((f) => f.type.startsWith('image/'));
          if (!files.length || !onUpload) return false;
          ev.preventDefault(); void addImages(files); return true;
        },
      },
      onUpdate: ({ editor: e }) => changed.current(htmlToMarkdown(e.getHTML())),
      onTransaction: () => tick((n) => n + 1),
    });
    ed.current = editor;
    return () => { editor.destroy(); ed.current = null; };
  }, []);

  const e = ed.current;
  const chain = () => e!.chain().focus();
  const is = (name: string, attrs?: Record<string, unknown>) => Boolean(e?.isActive(name, attrs));
  const block = !e ? 'p' : is('heading', { level: 2 }) ? 'h2' : is('heading', { level: 3 }) ? 'h3' : is('heading', { level: 4 }) ? 'h4' : 'p';

  function setBlock(v: string) {
    if (v === 'p') chain().setParagraph().run();
    else chain().setHeading({ level: Number(v[1]) as 2 | 3 | 4 }).run();
  }
  function openLink() {
    setHref((e?.getAttributes('link').href as string) ?? '');
    setLinkOpen(true);
  }
  function applyLink(ev: Event) {
    ev.preventDefault();
    let url = href.trim();
    if (!url) { chain().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); return; }
    if (/^(javascript|data|vbscript):/i.test(url)) return setErr('That link type is not allowed.');
    if (!/^(https?:\/\/|\/|#|mailto:|tel:)/i.test(url)) url = `https://${url}`;
    if (e!.state.selection.empty && !is('link')) chain().insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: url } }] }).run();
    else chain().extendMarkRange('link').setLink({ href: url }).run();
    setErr(''); setLinkOpen(false);
  }
  async function addImages(files: File[]) {
    if (!onUpload) return;
    setErr(''); setBusy(true);
    try {
      for (const f of files) {
        const src = await onUpload(f);
        const alt = f.name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ').trim();
        ed.current?.chain().focus().setImage({ src, alt }).run();
      }
    } catch (ex) { setErr((ex as Error).message || 'Upload failed. Please try again.'); }
    finally { setBusy(false); }
  }

  const imgSelected = is('image');
  const B = (p: { label: string; on?: boolean; run: () => void; children: preact.ComponentChildren; disabled?: boolean }) => (
    <button type="button" class="rte-btn" title={p.label} aria-label={p.label} aria-pressed={p.on === undefined ? undefined : p.on}
      disabled={!e || p.disabled} onMouseDown={(ev) => ev.preventDefault()} onClick={p.run}>{p.children}</button>
  );

  return (
    <div class="rte">
      <div class="rte-bar" role="toolbar" aria-label="Formatting">
        <select class="rte-select" aria-label="Text style" value={block} disabled={!e} onChange={(ev) => setBlock(ev.currentTarget.value)}>
          {BLOCKS.map(([v, l]) => <option value={v}>{l}</option>)}
        </select>
        <span class="rte-sep" />
        <B label="Bold (Ctrl+B)" on={is('bold')} run={() => chain().toggleBold().run()}><b>B</b></B>
        <B label="Italic (Ctrl+I)" on={is('italic')} run={() => chain().toggleItalic().run()}><i style="font-family:Georgia,serif">I</i></B>
        <B label="Strikethrough" on={is('strike')} run={() => chain().toggleStrike().run()}><s>S</s></B>
        <B label="Link (Ctrl+K)" on={is('link')} run={openLink}>{ICON.link}</B>
        <span class="rte-sep" />
        <B label="Bulleted list" on={is('bulletList')} run={() => chain().toggleBulletList().run()}>{ICON.ul}</B>
        <B label="Numbered list" on={is('orderedList')} run={() => chain().toggleOrderedList().run()}>{ICON.ol}</B>
        <B label="Quote" on={is('blockquote')} run={() => chain().toggleBlockquote().run()}>{ICON.quote}</B>
        <span class="rte-sep" />
        {onUpload && <B label="Add image" run={() => fileIn.current?.click()} disabled={busy}>{ICON.image}</B>}
        <B label="Add table" run={() => chain().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()}>{ICON.table}</B>
        <B label="Divider" run={() => chain().setHorizontalRule().run()}>{ICON.hr}</B>
        <B label="Clear formatting" run={() => chain().unsetAllMarks().clearNodes().run()}>{ICON.clear}</B>
        <span class="rte-grow" />
        <B label="Undo (Ctrl+Z)" run={() => chain().undo().run()} disabled={!e?.can().undo()}>{ICON.undo}</B>
        <B label="Redo (Ctrl+Shift+Z)" run={() => chain().redo().run()} disabled={!e?.can().redo()}>{ICON.redo}</B>
        <input ref={fileIn} type="file" accept="image/jpeg,image/png,image/webp" multiple hidden
          onChange={(ev) => { const f = [...(ev.currentTarget.files ?? [])]; ev.currentTarget.value = ''; void addImages(f); }} />
      </div>

      {is('table') && (
        <div class="rte-sub" role="toolbar" aria-label="Table">
          <span class="muted">Table:</span>
          <button type="button" class="btn btn-outline btn-sm" onClick={() => chain().addRowAfter().run()}>+ Row</button>
          <button type="button" class="btn btn-outline btn-sm" onClick={() => chain().addColumnAfter().run()}>+ Column</button>
          <button type="button" class="btn btn-outline btn-sm" onClick={() => chain().deleteRow().run()}>Remove row</button>
          <button type="button" class="btn btn-outline btn-sm" onClick={() => chain().deleteColumn().run()}>Remove column</button>
          <button type="button" class="btn btn-outline btn-sm" onClick={() => chain().deleteTable().run()}>Delete table</button>
        </div>
      )}
      {imgSelected && (
        <div class="rte-sub">
          <label class="rte-inline">Image description (for Google and screen readers)
            <input value={(e?.getAttributes('image').alt as string) ?? ''} maxLength={150}
              onInput={(ev) => e!.chain().updateAttributes('image', { alt: ev.currentTarget.value }).run()} /></label>
        </div>
      )}
      {linkOpen && (
        <form class="rte-sub" onSubmit={applyLink}>
          <label class="rte-inline">Link address
            <input autoFocus value={href} placeholder="https://… or /blog/…" onInput={(ev) => setHref(ev.currentTarget.value)}
              onKeyDown={(ev) => ev.key === 'Escape' && setLinkOpen(false)} /></label>
          <button class="btn btn-acc btn-sm">Apply</button>
          {is('link') && <button type="button" class="btn btn-outline btn-sm" onClick={() => { chain().extendMarkRange('link').unsetLink().run(); setLinkOpen(false); }}>Remove link</button>}
          <button type="button" class="btn btn-outline btn-sm" onClick={() => setLinkOpen(false)}>Cancel</button>
        </form>
      )}

      <div ref={host} class="rte-area prose" onKeyDown={(ev) => { if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === 'k') { ev.preventDefault(); openLink(); } }} />
      {(busy || err) && <p class={err ? 'form-error' : 'muted'} role={err ? 'alert' : 'status'} style="margin:6px 0 0;font-size:13px">{err || 'Uploading image…'}</p>}
    </div>
  );
}

const svg = (d: string) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={d} /></svg>
);
const ICON = {
  link: svg('M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7'),
  ul: svg('M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01'),
  ol: svg('M10 6h10M10 12h10M10 18h10M4 4v4M3 8h2M3 14h2l-2 3h2M3 20h2'),
  quote: svg('M7 7h4v6H5v-2a4 4 0 0 1 2-4zm10 0h4v6h-6v-2a4 4 0 0 1 2-4z'),
  image: svg('M3 5h18v14H3zM3 16l5-5 4 4 3-3 6 6M15 9h.01'),
  table: svg('M3 5h18v14H3zM3 10h18M3 15h18M9 5v14M15 5v14'),
  hr: svg('M3 12h18'),
  clear: svg('M4 7V5h13v2M10.5 5 8 19M6 19h5M15 14l6 6M21 14l-6 6'),
  undo: svg('M9 14 4 9l5-5M4 9h11a5 5 0 0 1 0 10h-3'),
  redo: svg('m15 14 5-5-5-5M20 9H9a5 5 0 0 0 0 10h3'),
};
