import { useEffect, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { Toast, useToast } from '../shared';
import { toSlug } from './Taxonomy';

type BC = { id?: number; slug: string; name: string; description: string | null; seo_title: string | null; seo_description: string | null; sort: number; active: boolean };
type Count = { category_id: number; status: string; published_at: string | null };

export function BlogCategories() {
  const [rows, setRows] = useState<BC[]>([]);
  const [posts, setPosts] = useState<Count[]>([]);
  const [edit, setEdit] = useState<BC | null>(null);
  const [del, setDel] = useState<BC | null>(null);
  const [moveTo, setMoveTo] = useState('');
  const [toast, setToast] = useToast();

  async function load() {
    setRows(await must<BC[]>(sb().from('blog_categories').select('*').order('sort') as never));
    setPosts(await must<Count[]>(sb().from('posts').select('category_id,status,published_at') as never));
  }
  useEffect(() => { load(); }, []);
  const count = (id?: number) => posts.filter((p) => p.category_id === id).length;
  const hasLive = (id?: number) => posts.some((p) => p.category_id === id && p.status !== 'draft' && p.published_at && new Date(p.published_at).getTime() <= Date.now());

  async function save(e: Event) {
    e.preventDefault();
    if (!edit) return;
    const row = { slug: edit.slug, name: edit.name.trim(), description: edit.description?.trim() || null, seo_title: edit.seo_title?.trim() || null,
      seo_description: edit.seo_description?.trim() || null, sort: Number(edit.sort), active: edit.active };
    if (row.name.length < 2 || !row.slug) return setToast('Name and web address are required.');
    const { error } = edit.id ? await sb().from('blog_categories').update(row).eq('id', edit.id) : await sb().from('blog_categories').insert(row);
    if (error) return setToast(/duplicate/.test(error.message) ? 'Another category already uses that web address.' : /slug_locked/.test(error.message) ? 'This category has live posts, so its web address is locked.' : friendly(error));
    setToast(edit.id ? 'Category saved' : `"${row.name}" added`); setEdit(null); load();
  }
  async function move(c: BC, d: -1 | 1) {
    const i = rows.findIndex((r) => r.id === c.id); const o = rows[i + d];
    if (!o) return;
    await sb().from('blog_categories').update({ sort: o.sort }).eq('id', c.id!);
    await sb().from('blog_categories').update({ sort: c.sort === o.sort ? c.sort + d : c.sort }).eq('id', o.id!);
    load();
  }
  async function toggle(c: BC) {
    const { error } = await sb().from('blog_categories').update({ active: !c.active }).eq('id', c.id!);
    if (error) return setToast(friendly(error));
    setToast(c.active ? `${c.name} hidden (its posts are hidden too)` : `${c.name} shown`); load();
  }
  async function confirmDelete() {
    if (!del) return;
    const n = count(del.id);
    if (n && !moveTo) return setToast('Choose where to move its posts first.');
    const { error } = await sb().rpc('editor_delete_blog_category', { p_id: del.id, p_move_to: n ? Number(moveTo) : null });
    if (error) return setToast(friendly(error));
    setToast(n ? `Moved ${n} post${n === 1 ? '' : 's'} and deleted ${del.name}` : `${del.name} deleted`); setDel(null); setMoveTo(''); load();
  }

  return (
    <>
      <div class="dhead"><h1>Blog categories</h1>
        <button class="btn btn-primary" onClick={() => setEdit({ slug: '', name: '', description: '', seo_title: '', seo_description: '', sort: (rows.at(-1)?.sort ?? 100) + 10, active: true })}>+ Add category</button></div>
      <section class="panel" style="padding:0;overflow:hidden"><div class="scroll-x">
        <table class="tbl" style="min-width:640px">
          <thead><tr><th style="padding-left:16px">Order</th><th>Name</th><th>Web address</th><th>Posts</th><th>Shown</th><th /></tr></thead>
          <tbody>{rows.map((c, i) => (
            <tr style={c.active ? '' : 'opacity:.6'}>
              <td style="padding-left:16px;white-space:nowrap"><button class="btn btn-outline btn-sm" aria-label={`Move ${c.name} up`} disabled={i === 0} onClick={() => move(c, -1)}>↑</button> <button class="btn btn-outline btn-sm" aria-label={`Move ${c.name} down`} disabled={i === rows.length - 1} onClick={() => move(c, 1)}>↓</button></td>
              <td><b>{c.name}</b>{c.description && <span class="muted" style="display:block;font-size:12px">{c.description.slice(0, 70)}</span>}</td>
              <td style="font-size:13px">/blog/category/{c.slug}/{hasLive(c.id) && ' 🔒'}</td>
              <td>{count(c.id)}</td>
              <td><button class="btn btn-outline btn-sm" onClick={() => toggle(c)}>{c.active ? 'Shown' : 'Hidden'}</button></td>
              <td style="white-space:nowrap"><button class="btn btn-outline btn-sm" onClick={() => setEdit(c)}>Edit</button> <button class="btn btn-outline btn-sm" onClick={() => { setDel(c); setMoveTo(''); }}>Delete</button></td>
            </tr>
          ))}</tbody>
        </table></div>
      </section>

      {del && (
        <section class="panel" role="dialog" aria-label={`Delete ${del.name}`} style="border-color:#e3b9c6">
          <h2>Delete "{del.name}"?</h2>
          {count(del.id) ? (
            <><p style="margin:0">This category has {count(del.id)} post{count(del.id) === 1 ? '' : 's'}. Move them to:</p>
              <label class="field" style="max-width:320px"><span class="sr-only">Move posts to</span><select value={moveTo} onChange={(e) => setMoveTo(e.currentTarget.value)}>
                <option value="">Choose a category…</option>{rows.filter((r) => r.id !== del.id).map((r) => <option value={r.id}>{r.name}</option>)}</select></label></>
          ) : <p style="margin:0">It has no posts.</p>}
          <div style="display:flex;gap:10px"><button class="btn btn-primary" onClick={confirmDelete}>{count(del.id) ? 'Move posts and delete' : 'Delete'}</button><button class="btn btn-outline" onClick={() => setDel(null)}>Cancel</button></div>
        </section>
      )}

      {edit && (
        <form class="panel" onSubmit={save} aria-label="Blog category editor">
          <h2>{edit.id ? `Edit ${edit.name}` : 'New blog category'}</h2>
          <div class="grid2">
            <label class="field">Name<input value={edit.name} required onInput={(e) => { const name = e.currentTarget.value; setEdit({ ...edit, name, slug: edit.id ? edit.slug : toSlug(name) }); }} /></label>
            <label class="field">Web address<input value={edit.slug} disabled={hasLive(edit.id)} onInput={(e) => setEdit({ ...edit, slug: toSlug(e.currentTarget.value) })} />
              <span class="muted" style="font-weight:400">{hasLive(edit.id) ? 'Locked: has live posts. You can still rename it.' : `/blog/category/${edit.slug || '…'}/`}</span></label>
            <label class="field span2">Description (shown at the top of the category page)<textarea rows={2} value={edit.description ?? ''} onInput={(e) => setEdit({ ...edit, description: e.currentTarget.value })} /></label>
            <label class="field">SEO title<input value={edit.seo_title ?? ''} maxLength={70} onInput={(e) => setEdit({ ...edit, seo_title: e.currentTarget.value })} /></label>
            <label class="field">Order<input type="number" value={edit.sort} onInput={(e) => setEdit({ ...edit, sort: Number(e.currentTarget.value) })} /></label>
            <label class="field span2">Meta description<textarea rows={2} maxLength={320} value={edit.seo_description ?? ''} onInput={(e) => setEdit({ ...edit, seo_description: e.currentTarget.value })} /></label>
          </div>
          <div style="display:flex;gap:10px"><button class="btn btn-primary">Save category</button><button type="button" class="btn btn-outline" onClick={() => setEdit(null)}>Cancel</button></div>
        </form>
      )}
      <Toast text={toast} />
    </>
  );
}
