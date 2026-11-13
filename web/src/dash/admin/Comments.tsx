import { useEffect, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { ago, Toast, useToast } from '../shared';

type C = { id: string; post_id: string; parent_id: string | null; author_name: string; author_email: string; body: string; status: string; is_staff: boolean; created_at: string; posts: { title: string; slug: string } };

// postId: quick view for one post (opened from Blog posts), without the page title and post filter.
export function Comments({ onChange, postId }: { onChange: () => void; postId?: string }) {
  const [status, setStatus] = useState('pending');
  const [post, setPost] = useState(postId ?? '');
  const [rows, setRows] = useState<C[] | null>(null);
  const [posts, setPosts] = useState<{ id: string; title: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [toast, setToast] = useToast();

  async function load() {
    let q = sb().from('comments').select('*, posts(title,slug)').eq('status', status);
    if (post) q = q.eq('post_id', post);
    setRows(await must<C[]>(q.order('created_at', { ascending: status === 'pending' }).limit(200) as never));
    setSel(new Set());
  }
  useEffect(() => { load(); }, [status, post]);
  useEffect(() => { if (!postId) must<{ id: string; title: string }[]>(sb().from('posts').select('id,title').order('title') as never).then(setPosts); }, []);

  async function moderate(ids: string[], to: string) {
    if (!ids.length) return;
    const { data, error } = await sb().rpc('admin_moderate_comments', { p_ids: ids, p_status: to });
    if (error) return setToast(friendly(error));
    setToast(`${data} comment${data === 1 ? '' : 's'} ${to === 'approved' ? 'approved' : to === 'spam' ? 'marked as spam' : to}`);
    load(); onChange();
  }
  async function sendReply(c: C) {
    if (reply.trim().length < 2) return;
    const { error } = await sb().rpc('admin_reply_comment', { p_parent: c.parent_id ?? c.id, p_body: reply });
    if (error) return setToast(friendly(error));
    setToast('Reply published'); setReply(''); setReplyTo(null); load(); onChange();
  }
  const toggle = (id: string) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  const all = rows?.map((r) => r.id) ?? [];
  const inp = 'font:inherit;font-size:14px;border:1px solid var(--ln);border-radius:10px;padding:0 12px;min-height:44px;background:#fff';

  return (
    <>
      <div class="dhead">{postId ? <span /> : <h1>Comments</h1>}
        <div class="seg" role="group" aria-label="Comment status">
          {[['pending', 'Pending'], ['approved', 'Approved'], ['spam', 'Spam'], ['rejected', 'Rejected']].map(([k, l]) => <button type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}</button>)}
        </div></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;align-items:center">
        {!postId && <label><span class="sr-only">Filter by post</span><select value={post} onChange={(e) => setPost(e.currentTarget.value)} style={inp}>
          <option value="">All posts</option>{posts.map((p) => <option value={p.id}>{p.title}</option>)}</select></label>}
        {rows && rows.length > 0 && <>
          <label class="check"><input type="checkbox" checked={sel.size === all.length} onChange={() => setSel(sel.size === all.length ? new Set() : new Set(all))} /> Select all ({sel.size})</label>
          {status !== 'approved' && <button class="btn btn-green btn-sm" disabled={!sel.size} onClick={() => moderate([...sel], 'approved')}>Approve selected</button>}
          {status !== 'rejected' && <button class="btn btn-outline btn-sm" disabled={!sel.size} onClick={() => moderate([...sel], 'rejected')}>Reject selected</button>}
          {status !== 'spam' && <button class="btn btn-outline btn-sm" disabled={!sel.size} onClick={() => moderate([...sel], 'spam')}>Spam selected</button>}
        </>}
      </div>
      {!rows ? <p class="muted">Loading…</p> : rows.length === 0 ? <div class="panel"><p class="empty">No {status} comments.</p></div> : rows.map((c) => (
        <section class="panel" aria-label={`Comment by ${c.author_name}`} style={c.is_staff ? 'border-color:#b83260' : ''}>
          <div class="dhead" style="align-items:flex-start">
            <label class="check" style="align-items:flex-start"><input type="checkbox" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select comment by ${c.author_name}`} />
              <span><b>{c.author_name}</b>{c.is_staff && <span class="chip-s s-new" style="margin-left:6px">Team</span>}
                <span class="muted" style="display:block;font-size:13px">{c.author_email} · {ago(c.created_at)} · on <a href={`/blog/${c.posts.slug}/`} target="_blank" rel="noopener">{c.posts.title}</a>{c.parent_id ? ' · reply' : ''}</span></span></label>
          </div>
          <p style="margin:0;line-height:1.6;white-space:pre-line">{c.body}</p>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            {status !== 'approved' && <button class="btn btn-green btn-sm" onClick={() => moderate([c.id], 'approved')}>Approve</button>}
            {status !== 'rejected' && <button class="btn btn-outline btn-sm" onClick={() => moderate([c.id], 'rejected')}>Reject</button>}
            {status !== 'spam' && <button class="btn btn-outline btn-sm" onClick={() => moderate([c.id], 'spam')}>Spam</button>}
            {!c.is_staff && status !== 'spam' && <button class="btn btn-outline btn-sm" onClick={() => { setReplyTo(c.id); setReply(''); }}>Reply</button>}
          </div>
          {replyTo === c.id && (
            <div style="display:flex;flex-direction:column;gap:8px">
              <label class="field">Reply as the site team (published straight away{c.status === 'pending' ? '; also approves this comment' : ''})
                <textarea rows={3} value={reply} onInput={(e) => setReply(e.currentTarget.value)} /></label>
              <div style="display:flex;gap:8px"><button class="btn btn-primary btn-sm" onClick={() => sendReply(c)}>Publish reply</button><button class="btn btn-outline btn-sm" onClick={() => setReplyTo(null)}>Cancel</button></div>
            </div>
          )}
        </section>
      ))}
      <Toast text={toast} />
    </>
  );
}
