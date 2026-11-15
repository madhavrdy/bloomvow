// Admin > Comments: moderate blog comments and reply as the site team.
// Pending shows the queue oldest first, with what a reply answers and warning signs (links, first-time
// commenters). Approved shows each conversation as a thread so replies are easy to follow.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { ago, Toast, useToast } from '../shared';
import { initials, hue, hasLink, fullDate } from '../../lib/commentLook';

type C = {
  id: string; post_id: string; parent_id: string | null; author_name: string; author_email: string; body: string;
  status: 'pending' | 'approved' | 'rejected' | 'spam'; is_staff: boolean; created_at: string;
  posts: { title: string; slug: string }; parent: { author_name: string; body: string; status: string } | null;
};
type Status = C['status'];
const TABS: [Status, string][] = [['pending', 'Pending'], ['approved', 'Approved'], ['spam', 'Spam'], ['rejected', 'Rejected']];

// postId: quick view for one post (opened from Blog posts), without the page title and post filter.
export function Comments({ onChange, postId }: { onChange: () => void; postId?: string }) {
  const [status, setStatus] = useState<Status>('pending');
  const [post, setPost] = useState(postId ?? '');
  const [rows, setRows] = useState<C[] | null>(null);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [trusted, setTrusted] = useState<Map<string, number>>(new Map());
  const [posts, setPosts] = useState<{ id: string; title: string }[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [compose, setCompose] = useState<{ id: string; mode: 'reply' | 'edit' } | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useToast();

  async function load() {
    let q = sb().from('comments').select('*, posts(title,slug), parent:parent_id(author_name,body,status)');
    q = status === 'approved' ? q.in('status', ['approved']) : q.eq('status', status);
    if (post) q = q.eq('post_id', post);
    const list = await must<C[]>(q.order('created_at', { ascending: status === 'pending' }).limit(200) as never);
    setRows(list); setSel(new Set());
    // How many approved comments each commenter already has (trust signal for the queue).
    const emails = [...new Set(list.filter((c) => !c.is_staff).map((c) => c.author_email.toLowerCase()))];
    if (status !== 'approved' && emails.length) {
      const { data } = await sb().from('comments').select('author_email').eq('status', 'approved').in('author_email', emails).limit(1000);
      const m = new Map<string, number>();
      for (const r of (data ?? []) as { author_email: string }[]) m.set(r.author_email.toLowerCase(), (m.get(r.author_email.toLowerCase()) ?? 0) + 1);
      setTrusted(m);
    }
    const n = await Promise.all(TABS.map(async ([k]) => {
      let c = sb().from('comments').select('id', { count: 'exact', head: true }).eq('status', k);
      if (post) c = c.eq('post_id', post);
      const { count } = await c; return [k, count ?? 0] as const;
    }));
    setCounts(Object.fromEntries(n));
  }
  useEffect(() => { setRows(null); load(); }, [status, post]);
  useEffect(() => { if (!postId) must<{ id: string; title: string }[]>(sb().from('posts').select('id,title').order('title') as never).then(setPosts); }, []);

  async function moderate(ids: string[], to: Status) {
    if (!ids.length) return;
    const { data, error } = await sb().rpc('admin_moderate_comments', { p_ids: ids, p_status: to });
    if (error) return setToast(friendly(error));
    setToast(`${data} comment${data === 1 ? '' : 's'} ${to === 'approved' ? 'approved' : to === 'spam' ? 'marked as spam' : to === 'rejected' ? 'rejected' : to}`);
    load(); onChange();
  }
  async function send(c: C) {
    if (!compose || text.trim().length < 2) return;
    setBusy(true);
    const { error } = compose.mode === 'reply'
      ? await sb().rpc('admin_reply_comment', { p_parent: c.parent_id ?? c.id, p_body: text })
      : await sb().from('comments').update({ body: text.trim() }).eq('id', c.id);
    setBusy(false);
    if (error) return setToast(friendly(error));
    setToast(compose.mode === 'reply' ? (c.status === 'pending' ? 'Reply published and comment approved' : 'Reply published') : 'Reply updated');
    setText(''); setCompose(null); load(); onChange();
  }
  const toggle = (id: string) => { const s = new Set(sel); s.has(id) ? s.delete(id) : s.add(id); setSel(s); };
  const all = rows?.map((r) => r.id) ?? [];

  // Approved: group replies under their comment.
  const threads = useMemo(() => {
    if (!rows || status !== 'approved') return null;
    const ids = new Set(rows.map((r) => r.id));
    const tops = rows.filter((r) => !r.parent_id || !ids.has(r.parent_id));
    return tops.map((t) => ({ t, replies: rows.filter((r) => r.parent_id === t.id).sort((a, b) => a.created_at.localeCompare(b.created_at)) }));
  }, [rows, status]);

  const card = (c: C, nested = false) => {
    const link = hasLink(c.body);
    const prior = trusted.get(c.author_email.toLowerCase()) ?? 0;
    const open = compose?.id === c.id;
    return (
      <article class={`cm${nested ? ' cm-nested' : ''}${c.is_staff ? ' cm-staff' : ''}${sel.has(c.id) ? ' cm-sel' : ''}`} aria-label={`Comment by ${c.author_name}`}>
        {!nested && <input type="checkbox" class="cm-check" checked={sel.has(c.id)} onChange={() => toggle(c.id)} aria-label={`Select comment by ${c.author_name}`} />}
        <span class={`cm-av${c.is_staff ? ' cm-av-team' : ''}`} style={c.is_staff ? undefined : `--h:${hue(c.author_name)}`} aria-hidden="true">{c.is_staff ? '' : initials(c.author_name)}</span>
        <div class="cm-main">
          <div class="cm-head">
            <b>{c.author_name}</b>
            {c.is_staff && <span class="cm-tag cm-tag-team">Team</span>}
            {status !== 'approved' && !c.is_staff && (prior > 0
              ? <span class="cm-tag cm-tag-ok" title="Approved comments from this email">✓ {prior} approved before</span>
              : <span class="cm-tag">First comment</span>)}
            {link && !c.is_staff && <span class="cm-tag cm-tag-warn">Contains a link</span>}
            <span class="cm-meta" title={fullDate(c.created_at)}>{ago(c.created_at)}</span>
          </div>
          {!nested && <div class="cm-sub">{!c.is_staff && <>{c.author_email} · </>}on <a href={`/blog/${c.posts.slug}/`} target="_blank" rel="noopener">{c.posts.title}</a></div>}
          {c.parent && status !== 'approved' && (
            <blockquote class="cm-quote"><span>Replying to <b>{c.parent.author_name}</b>{c.parent.status !== 'approved' ? ` (${c.parent.status})` : ''}</span>{c.parent.body.length > 220 ? c.parent.body.slice(0, 220) + '…' : c.parent.body}</blockquote>
          )}
          <p class="cm-body">{c.body}</p>
          <div class="cm-actions">
            {c.status !== 'approved' && <button class="btn btn-green btn-sm" onClick={() => moderate([c.id], 'approved')}>Approve</button>}
            {!c.is_staff && c.status !== 'spam' && <button class="btn btn-outline btn-sm" onClick={() => { setCompose({ id: c.id, mode: 'reply' }); setText(''); }}>Reply</button>}
            {c.is_staff && <button class="btn btn-outline btn-sm" onClick={() => { setCompose({ id: c.id, mode: 'edit' }); setText(c.body); }}>Edit</button>}
            {c.status === 'approved' && <button class="btn btn-outline btn-sm" onClick={() => moderate([c.id], 'rejected')}>Unpublish</button>}
            {c.status === 'pending' && <button class="btn btn-outline btn-sm" onClick={() => moderate([c.id], 'rejected')}>Reject</button>}
            {c.status !== 'spam' && !c.is_staff && <button class="btn btn-outline btn-sm cm-spam" onClick={() => moderate([c.id], 'spam')}>Spam</button>}
            {c.status === 'approved' && <a class="cm-view" href={`/blog/${c.posts.slug}/#c-${c.id}`} target="_blank" rel="noopener">View on site ↗</a>}
          </div>
          {open && (
            <div class="cm-compose">
              <span class="cm-av cm-av-team cm-av-sm" aria-hidden="true" />
              <div class="cm-compose-main">
                <label class="field">{compose!.mode === 'edit' ? 'Edit your reply' : `Reply to ${c.author_name} as the site team`}
                  <textarea rows={3} value={text} maxLength={3000} onInput={(e) => setText(e.currentTarget.value)} autoFocus
                    placeholder="Thanks for your question…" /></label>
                <p class="muted" style="margin:0;font-size:12px">{compose!.mode === 'edit' ? 'Changes show on the site straight away.' : `Published straight away with a "Team" badge${c.status === 'pending' ? '. This also approves their comment' : ''}.`}</p>
                <div style="display:flex;gap:8px">
                  <button class="btn btn-primary btn-sm" disabled={busy || text.trim().length < 2} onClick={() => send(c)}>{compose!.mode === 'edit' ? 'Save' : 'Publish reply'}</button>
                  <button class="btn btn-outline btn-sm" onClick={() => setCompose(null)}>Cancel</button>
                </div>
              </div>
            </div>
          )}
        </div>
      </article>
    );
  };

  return (
    <>
      <div class="dhead">{postId ? <span /> : <h1>Comments</h1>}
        <div class="seg" role="group" aria-label="Comment status">
          {TABS.map(([k, l]) => <button type="button" aria-pressed={status === k} onClick={() => setStatus(k)}>{l}{counts[k] != null && <span class="cm-count">{counts[k]}</span>}</button>)}
        </div></div>
      <div class="cm-bar">
        {!postId && <label><span class="sr-only">Filter by post</span><select value={post} onChange={(e) => setPost(e.currentTarget.value)} class="cm-select">
          <option value="">All posts</option>{posts.map((p) => <option value={p.id}>{p.title}</option>)}</select></label>}
        {rows && rows.length > 0 && <>
          <label class="check"><input type="checkbox" checked={sel.size === all.length && all.length > 0} onChange={() => setSel(sel.size === all.length ? new Set() : new Set(all))} /> {sel.size ? `${sel.size} selected` : 'Select all'}</label>
          {sel.size > 0 && <>
            {status !== 'approved' && <button class="btn btn-green btn-sm" onClick={() => moderate([...sel], 'approved')}>Approve</button>}
            {status !== 'rejected' && <button class="btn btn-outline btn-sm" onClick={() => moderate([...sel], 'rejected')}>{status === 'approved' ? 'Unpublish' : 'Reject'}</button>}
            {status !== 'spam' && <button class="btn btn-outline btn-sm" onClick={() => moderate([...sel], 'spam')}>Spam</button>}
          </>}
        </>}
      </div>
      {!rows ? <p class="muted">Loading…</p>
        : rows.length === 0 ? <div class="panel cm-empty"><b>{status === 'pending' ? 'All caught up' : `No ${status} comments`}</b><span class="muted">{status === 'pending' ? 'New comments appear here for you to check before they go live.' : ''}</span></div>
        : threads ? threads.map(({ t, replies }) => (
            <section class="panel cm-thread">
              {card(t)}
              {replies.length > 0 && <div class="cm-replies">{replies.map((r) => card(r, true))}</div>}
            </section>))
        : rows.map((c) => <section class="panel cm-thread">{card(c)}</section>)}
      <Toast text={toast} />
    </>
  );
}
