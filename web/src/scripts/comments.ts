// Blog comment form: posts to submit_comment; every comment waits for moderation.
import { rpc, select, ApiError } from './api';

const messages: Record<string, string> = {
  invalid_email: 'Please enter a valid email address.',
  name_required: 'Please enter your name.',
  invalid_body: 'Please write a comment (2 to 3,000 characters).',
  too_many_links: 'Please include at most one link.',
  comments_closed: 'Comments are closed for this article.',
  rate_limited: "You've posted several comments recently. Please try again later.",
};
export const commentError = (e: unknown) => (e instanceof ApiError && messages[e.code]) || 'Something went wrong posting your comment. Please try again.';

type C = { id: string; parent_id: string | null; author_name: string; body: string; is_staff: boolean; created_at: string };
const fmt = (s: string) => new Date(s).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });

function el(tag: string, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // always text, never HTML
  return e;
}
function card(c: C, staff: string, reply: boolean, open: boolean) {
  const d = el('div', reply ? 'cmt cmt-reply' : 'cmt'); d.id = `c-${c.id}`;
  const head = el('div', 'cmt-head');
  head.append(el('b', undefined, c.author_name));
  if (c.is_staff) head.append(el('span', 'badge badge-green', staff));
  const t = el('time', 'muted', fmt(c.created_at)); t.setAttribute('datetime', c.created_at); head.append(t);
  d.append(head, el('p', undefined, c.body));
  if (!reply && open) {
    const b = el('button', 'linkish', 'Reply') as HTMLButtonElement;
    b.type = 'button'; b.dataset.reply = c.id; b.dataset.replyName = c.author_name; d.append(b);
  }
  return d;
}

// Comments are built into the page, then refreshed from the database so newly
// approved comments and replies show without waiting for a site rebuild.
export async function refreshComments(): Promise<void> {
  const list = document.querySelector<HTMLElement>('#cmt-list');
  if (!list?.dataset.post) return;
  let rows: C[];
  try {
    rows = await select<C>('public_comments', `select=id,parent_id,author_name,body,is_staff,created_at&post_id=eq.${encodeURIComponent(list.dataset.post)}&order=created_at,id`);
  } catch { return; } // keep the built-in comments
  const open = list.dataset.open === '1', staff = list.dataset.staff ?? 'Team';
  const frag = document.createDocumentFragment();
  for (const c of rows.filter((r) => !r.parent_id)) {
    const d = card(c, staff, false, open);
    for (const r of rows.filter((x) => x.parent_id === c.id)) d.append(card(r, staff, true, open));
    frag.append(d);
  }
  list.replaceChildren(frag);
  const h = document.querySelector('#comments-h');
  if (h) h.textContent = rows.length ? `${rows.length} comment${rows.length > 1 ? 's' : ''}` : 'Comments';
  if (location.hash.startsWith('#c-')) document.querySelector(location.hash)?.scrollIntoView();
}

export function initComments() {
  const form = document.querySelector<HTMLFormElement>('#comment-form');
  if (!form) return;
  const err = form.querySelector<HTMLElement>('.form-error')!;
  const replying = form.querySelector<HTMLElement>('#replying')!;
  let parent: string | null = null;
  const setReply = (id: string | null, name = '') => {
    parent = id;
    replying.hidden = !id;
    replying.querySelector('b')!.textContent = name;
    if (id) { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); form.querySelector<HTMLTextAreaElement>('textarea')!.focus(); }
  };
  // Delegated, so it also works for comments loaded after the page was built.
  document.querySelector('#cmt-list')?.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-reply]');
    if (b) setReply(b.dataset.reply!, b.dataset.replyName);
  });
  form.querySelector('#cancel-reply')!.addEventListener('click', () => setReply(null));

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const f = new FormData(form);
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    btn.disabled = true;
    try {
      await rpc('submit_comment', {
        payload: { post_id: form.dataset.post, parent_id: parent, name: f.get('name'), email: f.get('email'), body: f.get('body'), website: f.get('website') },
      });
      const ok = document.createElement('div');
      ok.className = 'form-ok';
      ok.setAttribute('role', 'status');
      ok.textContent = 'Thanks! Your comment is awaiting moderation and will appear once approved.';
      form.replaceWith(ok);
    } catch (e) {
      err.textContent = commentError(e);
      btn.disabled = false;
    }
  });
}
