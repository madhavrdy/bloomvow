import { shrinkImage, extOf, MAX_ORIGINAL } from '../image';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { ago, fmtDate, Toast, useToast, type Ref } from '../shared';
import { renderMarkdown, plainText, readingMinutes } from '../../lib/markdown';
import { toSlug } from './Taxonomy';
import { RichEditor } from '../editor/RichEditor';

type BlogCat = { id: number; name: string; slug: string; active: boolean };
export type Post = {
  id?: string; slug: string; title: string; excerpt: string | null; body: string; cover_url: string | null; cover_alt: string | null;
  author_name: string | null; category_id: number | null; status: 'draft' | 'scheduled' | 'published'; published_at: string | null;
  seo_title: string | null; seo_description: string | null; city_id: number | null; vendor_category_id: number | null; comments_open: boolean; updated_at?: string;
};

// Public state of a post from its status and date.
export function postState(p: Pick<Post, 'status' | 'published_at'>, now = Date.now()): { label: string; cls: string } {
  if (p.status === 'draft' || !p.published_at) return { label: 'Draft', cls: 's-lost' };
  if (new Date(p.published_at).getTime() > now) return { label: `Scheduled ${fmtDate(p.published_at)}`, cls: 's-pending' };
  return { label: 'Live', cls: 's-tour' };
}
const isLive = (p: Pick<Post, 'status' | 'published_at'>) => p.status !== 'draft' && Boolean(p.published_at) && new Date(p.published_at!).getTime() <= Date.now();
const localInput = (iso: string | null) => (iso ? new Date(new Date(iso).getTime() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16) : '');

type BuildStatus = { ready: boolean; waiting_since: string | null; last: { sent_at: string; result: string | null } | null };

// "Site update" line: new and edited posts open right away; the blog lists, categories and
// sitemap refresh with an automatic site rebuild (about 15 minutes).
function SiteUpdate({ onToast }: { onToast: (m: string) => void }) {
  const [s, setS] = useState<BuildStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const load = async () => { const { data } = await sb().rpc('site_build_status'); if (data) setS(data as BuildStatus); };
  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, []);
  if (!s) return null;
  const mins = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  const failed = Boolean(s.last?.result && s.last.result !== 'ok');
  const building = Boolean(s.last?.sent_at) && !failed && mins(s.last!.sent_at) < 16;
  const text = !s.ready
    ? 'Automatic site updates are not set up yet: new posts open from their link right away, and blog lists refresh with the nightly update.'
    : s.waiting_since ? 'Site update starting within a minute…'
    : failed ? `The last site update request failed (${s.last!.result}). Try again, or check the GitHub token.`
    : building ? `Site update in progress: started ${mins(s.last!.sent_at)} min ago, usually done in about 15 minutes.`
    : 'Publishing updates the site automatically. New posts open from their link right away; blog lists refresh in about 15 minutes.';
  async function now() {
    setBusy(true);
    const { data, error } = await sb().rpc('request_site_build');
    setBusy(false);
    if (error) return onToast(friendly(error));
    setS(data as BuildStatus);
    onToast((data as BuildStatus).ready ? 'Site update requested' : 'Saved the request: it will run once automatic updates are set up');
  }
  return (
    <p class={`site-update${failed ? ' is-bad' : ''}`} role="status">
      <span>{text}</span>
      {s.ready && !s.waiting_since && <button class="btn btn-outline btn-sm" disabled={busy} onClick={now}>Update site now</button>}
    </p>
  );
}

export function Posts({ ref_, userId, userName }: { ref_: Ref; userId: string; userName: string }) {
  const [rows, setRows] = useState<(Post & { id: string; updated_at: string })[] | null>(null);
  const [cats, setCats] = useState<BlogCat[]>([]);
  const [edit, setEdit] = useState<Post | null>(null);
  const [filter, setFilter] = useState('all');
  const [toast, setToast] = useToast();

  async function load() {
    setRows(await must(sb().from('posts').select('*').order('updated_at', { ascending: false }) as never));
    setCats(await must<BlogCat[]>(sb().from('blog_categories').select('id,name,slug,active').order('sort') as never));
  }
  useEffect(() => { load(); }, []);

  if (edit) return <Editor post={edit} cats={cats} ref_={ref_} userId={userId} onClose={(msg) => { setEdit(null); if (msg) setToast(msg); load(); }} />;
  if (!rows) return <p class="muted">Loading posts…</p>;
  const shown = rows.filter((p) => filter === 'all' || postState(p).label.startsWith(filter));
  const blank: Post = { slug: '', title: '', excerpt: '', body: '', cover_url: null, cover_alt: null, author_name: userName || null, category_id: cats.find((c) => c.active)?.id ?? null,
    status: 'draft', published_at: null, seo_title: null, seo_description: null, city_id: null, vendor_category_id: null, comments_open: true };
  return (
    <>
      <div class="dhead"><h1>Blog posts</h1><button class="btn btn-primary" onClick={() => setEdit(blank)}>+ New post</button></div>
      <SiteUpdate onToast={setToast} />
      <div class="seg" role="group" aria-label="Filter posts">
        {['all', 'Live', 'Scheduled', 'Draft'].map((f) => <button type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>{f === 'all' ? `All (${rows.length})` : f}</button>)}
      </div>
      <section class="panel" style="padding:0;overflow:hidden"><div class="scroll-x">
        <table class="tbl" style="min-width:680px">
          <thead><tr><th style="padding-left:16px">Title</th><th>Category</th><th>Status</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {shown.length === 0 && <tr><td colSpan={5} class="empty">No posts yet. Start with a "cost of a wedding venue in [city]" guide: those rank and convert best.</td></tr>}
            {shown.map((p) => {
              const st = postState(p);
              return <tr>
                <td style="padding-left:16px"><b>{p.title}</b><span class="muted" style="display:block;font-size:12px">/blog/{p.slug}/</span></td>
                <td>{cats.find((c) => c.id === p.category_id)?.name}</td>
                <td><span class={`chip-s ${st.cls}`}>{st.label}</span></td>
                <td style="font-size:13px">{ago(p.updated_at)}</td>
                <td style="white-space:nowrap"><button class="btn btn-outline btn-sm" onClick={() => setEdit(p)}>Edit</button>
                  {isLive(p) && <> <a class="btn btn-outline btn-sm" href={`/blog/${p.slug}/`} target="_blank" rel="noopener" title="Opens the post on the site">View ↗</a></>}</td>
              </tr>;
            })}
          </tbody>
        </table></div>
      </section>
      <Toast text={toast} />
    </>
  );
}

function Editor({ post, cats, ref_, userId, onClose }: { post: Post; cats: BlogCat[]; ref_: Ref; userId: string; onClose: (msg?: string) => void }) {
  const [p, setP] = useState<Post>(post);
  const [slugTouched, setSlugTouched] = useState(Boolean(post.id));
  const [mode, setMode] = useState<'visual' | 'write' | 'preview'>('visual');
  const [when, setWhen] = useState(localInput(post.published_at));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const live = Boolean(post.id) && isLive(post);
  const set = <K extends keyof Post>(k: K, v: Post[K]) => setP({ ...p, [k]: v });
  const preview = useMemo(() => renderMarkdown(p.body).html, [p.body, mode]);
  const words = p.body.split(/\s+/).filter(Boolean).length;
  const metaDesc = p.seo_description || p.excerpt || plainText(p.body, 155);

  async function save(status: Post['status']) {
    setErr('');
    if (p.title.trim().length < 3) return setErr('Please add a title.');
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(p.slug)) return setErr('The web address can only use lowercase letters, numbers and dashes.');
    if (!p.category_id) return setErr('Please choose a category.');
    let published_at: string | null = p.published_at;
    if (status === 'published') published_at = p.published_at && isLive(p) ? p.published_at : new Date().toISOString();
    if (status === 'scheduled') {
      if (!when) return setErr('Choose the date and time to publish.');
      published_at = new Date(when).toISOString();
      if (new Date(published_at).getTime() <= Date.now()) return setErr('Scheduled time must be in the future (or use Publish now).');
    }
    if (status === 'draft') published_at = null;
    setBusy(true);
    const row = { ...p, title: p.title.trim(), excerpt: p.excerpt?.trim() || null, seo_title: p.seo_title?.trim() || null, seo_description: p.seo_description?.trim() || null,
      status, published_at, author_id: post.id ? undefined : userId };
    delete (row as Partial<Post>).updated_at;
    const { error } = post.id ? await sb().from('posts').update(row).eq('id', post.id) : await sb().from('posts').insert(row);
    setBusy(false);
    if (error) {
      if (/posts_slug_key|duplicate/.test(error.message)) return setErr('Another post already uses this web address.');
      if (/slug_locked/.test(error.message)) return setErr('This post is live, so its web address is locked.');
      return setErr(friendly(error));
    }
    onClose(status === 'published' ? `Published: /blog/${p.slug}/ opens now; blog lists update in about 15 minutes` : status === 'scheduled' ? `Scheduled for ${fmtDate(published_at)}` : 'Draft saved');
  }
  async function remove() {
    if (!post.id || !confirm(`Delete "${post.title}" and its comments permanently?`)) return;
    const { error } = await sb().from('posts').delete().eq('id', post.id);
    if (error) return setErr(friendly(error));
    onClose('Post deleted');
  }
  // Uploads one image to the blog-images bucket and returns its public URL.
  async function uploadImage(original: File): Promise<string> {
    if (!/^image\/(jpeg|png|webp)$/.test(original.type)) throw new Error('Please upload a JPG, PNG or WebP image.');
    if (original.size > MAX_ORIGINAL) throw new Error('That image is larger than 25 MB.');
    const file = await shrinkImage(original, 2000);
    if (file.size > 5 * 1024 * 1024) throw new Error('That image is too large even after resizing.');
    const path = `${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${extOf(file)}`;
    const { error } = await sb().storage.from('blog-images').upload(path, file, { contentType: file.type, cacheControl: '31536000' });
    if (error) throw new Error(friendly(error));
    return sb().storage.from('blog-images').getPublicUrl(path).data.publicUrl;
  }
  async function upload(e: Event) {
    const original = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!original) return;
    try {
      const url = await uploadImage(original);
      setP((cur) => ({ ...cur, cover_url: url, cover_alt: cur.cover_alt || cur.title }));
    } catch (ex) { setErr((ex as Error).message); }
  }

  return (
    <div class="row" style="align-items:flex-start">
      <div class="grow" style="display:flex;flex-direction:column;gap:16px">
        <div class="dhead"><h1>{post.id ? 'Edit post' : 'New post'}</h1>
          <div class="row" style="gap:8px">
            {isLive(post) && <a class="btn btn-outline btn-sm" href={`/blog/${post.slug}/`} target="_blank" rel="noopener">View post ↗</a>}
            <button class="btn btn-outline btn-sm" onClick={() => onClose()}>← All posts</button></div></div>
        {isLive(post) && <p class="muted" style="margin:-8px 0 0;font-size:13px">Live at <a href={`/blog/${post.slug}/`} target="_blank" rel="noopener">{location.host}/blog/{post.slug}/</a>. Saved edits show there once the site updates (about 15 minutes).</p>}
        <section class="panel">
          <label class="field">Title<input value={p.title} maxLength={200} style="font-size:20px;font-weight:700"
            onInput={(e) => { const t = e.currentTarget.value; setP({ ...p, title: t, slug: slugTouched ? p.slug : toSlug(t).slice(0, 80) }); }} /></label>
          <label class="field">Web address<div style="display:flex;align-items:center;gap:4px"><span class="muted">/blog/</span>
            <input value={p.slug} disabled={live} onInput={(e) => { setSlugTouched(true); set('slug', toSlug(e.currentTarget.value)); }} style="flex:1" /><span class="muted">/</span></div>
            {live && <span class="muted" style="font-weight:400">Locked: this post is live.</span>}</label>
          <label class="field">Excerpt (shown in lists and as the default meta description)<textarea rows={2} maxLength={400} value={p.excerpt ?? ''} onInput={(e) => set('excerpt', e.currentTarget.value)} /></label>
        </section>
        <section class="panel">
          <div class="dhead"><div class="seg" role="group" aria-label="Editor mode">
            <button type="button" aria-pressed={mode === 'visual'} onClick={() => setMode('visual')}>Visual</button>
            <button type="button" aria-pressed={mode === 'write'} onClick={() => setMode('write')}>Markdown</button>
            <button type="button" aria-pressed={mode === 'preview'} onClick={() => setMode('preview')}>Preview</button></div>
            <span class="muted" style="font-size:13px">{words} words · {readingMinutes(p.body)} min read</span></div>
          {mode === 'visual' ? (
            <RichEditor value={p.body} onChange={(md) => setP((cur) => ({ ...cur, body: md }))} onUpload={uploadImage}
              placeholder="Start writing, or paste from Google Docs or Word…" />
          ) : mode === 'write' ? (
            <>
              <label class="field"><span class="sr-only">Post body</span>
                <textarea rows={22} value={p.body} onInput={(e) => set('body', e.currentTarget.value)} style="font-family:ui-monospace,Menlo,monospace;font-size:14px;line-height:1.6"
                  placeholder={'## A heading\n\nWrite in plain text. **bold**, *italic*, [a link](https://…), - bullet lists.\n\n## Another heading'} /></label>
              <span class="muted" style="font-size:12px">Formatting: ## heading · **bold** · *italic* · [link text](url) · - list · 1. numbered list · ![image description](image url)</span>
            </>
          ) : <article class="prose" style="line-height:1.7" dangerouslySetInnerHTML={{ __html: preview || '<p class="muted">Nothing to preview yet.</p>' }} />}
        </section>
        <section class="panel"><h2>Search engine listing</h2>
          <div style="border:1px solid var(--ln);border-radius:12px;padding:14px;font-family:Arial,sans-serif">
            <div style="color:#1a0dab;font-size:18px">{(p.seo_title || p.title || 'Post title').slice(0, 60)}</div>
            <div style="color:#006621;font-size:13px">{location.host} › blog › {p.slug || 'post'}</div>
            <div style="color:#545454;font-size:13px">{metaDesc.slice(0, 160) || 'Description…'}</div>
          </div>
          <label class="field">SEO title (optional, ~60 characters)<input value={p.seo_title ?? ''} maxLength={70} onInput={(e) => set('seo_title', e.currentTarget.value)} /></label>
          <label class="field">Meta description (optional, ~155 characters)<textarea rows={2} maxLength={320} value={p.seo_description ?? ''} onInput={(e) => set('seo_description', e.currentTarget.value)} /></label>
        </section>
      </div>

      <aside class="side-col" style="display:flex;flex-direction:column;gap:16px;position:sticky;top:24px;max-width:360px">
        <section class="panel">
          <b>Status: <span class={`chip-s ${postState(p).cls}`}>{postState(p).label}</span></b>
          <button class="btn btn-primary btn-lg" disabled={busy} onClick={() => save('published')}>{live ? 'Update live post' : 'Publish now'}</button>
          {!live && <>
            <label class="field">Or schedule for<input type="datetime-local" value={when} onInput={(e) => setWhen(e.currentTarget.value)} /></label>
            <button class="btn btn-outline" disabled={busy} onClick={() => save('scheduled')}>Schedule</button>
          </>}
          <button class="btn btn-outline" disabled={busy} onClick={() => save('draft')}>{live ? 'Unpublish (back to draft)' : 'Save draft'}</button>
          {err && <p class="form-error" role="alert">{err}</p>}
          {post.id && <button class="linkbtn" style="color:#a3264f;align-self:flex-start" onClick={remove}>Delete post</button>}
        </section>
        <section class="panel">
          <label class="field">Category<select value={p.category_id ?? ''} onChange={(e) => set('category_id', Number(e.currentTarget.value))}>
            <option value="" disabled>Choose…</option>{cats.map((c) => <option value={c.id}>{c.name}{c.active ? '' : ' (hidden)'}</option>)}</select></label>
          <label class="field">Author name<input value={p.author_name ?? ''} onInput={(e) => set('author_name', e.currentTarget.value)} /></label>
          <label class="check"><input type="checkbox" checked={p.comments_open} onChange={(e) => set('comments_open', e.currentTarget.checked)} /> Allow comments</label>
        </section>
        <section class="panel"><b>Cover image</b>
          {p.cover_url ? <img src={p.cover_url} alt={p.cover_alt ?? ''} style="width:100%;border-radius:10px;aspect-ratio:16/9;object-fit:cover" /> : <div class="ph" style="aspect-ratio:16/9;border-radius:10px" />}
          <label class="btn btn-outline btn-sm" style="align-self:flex-start">{p.cover_url ? 'Replace image' : 'Upload image'}<input type="file" accept="image/jpeg,image/png,image/webp" class="sr-only" onChange={upload} /></label>
          {p.cover_url && <label class="field">Image description (alt text)<input value={p.cover_alt ?? ''} onInput={(e) => set('cover_alt', e.currentTarget.value)} /></label>}
        </section>
        <section class="panel"><b>Show as a "Planning guide" on</b>
          <span class="muted" style="font-size:12px">Links this post from matching directory pages (good for SEO).</span>
          <label class="field">City<input list="post-cities" value={p.city_id ? ref_.cityById.get(p.city_id)?.label ?? '' : ''}
            onChange={(e) => { const c = ref_.cities.find((x) => x.label.toLowerCase() === e.currentTarget.value.trim().toLowerCase()); set('city_id', c ? c.id : null); }} placeholder="Any city" />
            <datalist id="post-cities">{ref_.cities.map((c) => <option value={c.label} />)}</datalist></label>
          <label class="field">Vendor category<select value={p.vendor_category_id ?? ''} onChange={(e) => set('vendor_category_id', e.currentTarget.value ? Number(e.currentTarget.value) : null)}>
            <option value="">Any category</option>{ref_.categories.map((c) => <option value={c.id}>{c.name}</option>)}</select></label>
        </section>
      </aside>
    </div>
  );
}
