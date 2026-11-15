// Blog comments: live list (refreshed from the database) and the comment / reply form.
// Every comment waits for moderation. Replies are written right under the comment.
import { rpc, select, ApiError } from './api';
import { initials, hue, relTime, fullDate } from '../lib/commentLook';

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

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text; // always text, never HTML
  return e;
}
function avatar(c: C) {
  const a = el('span', c.is_staff ? 'cmt-av cmt-av-team' : 'cmt-av', c.is_staff ? '' : initials(c.author_name));
  a.setAttribute('aria-hidden', 'true');
  if (!c.is_staff) a.style.setProperty('--h', String(hue(c.author_name)));
  return a;
}
function card(c: C, staff: string, open: boolean, replies: C[]) {
  const d = el('article', c.parent_id ? 'cmt is-reply' : 'cmt'); d.id = `c-${c.id}`;
  const main = el('div', 'cmt-main');
  const head = el('header', 'cmt-head');
  head.append(el('b', 'cmt-name', c.author_name));
  if (c.is_staff) head.append(el('span', 'cmt-team', 'Team'));
  const t = el('time', 'cmt-time', relTime(c.created_at)); t.dateTime = c.created_at; t.title = fullDate(c.created_at);
  head.append(t);
  main.append(head, el('p', 'cmt-body', c.body));
  if (!c.parent_id) {
    if (open) {
      const actions = el('div', 'cmt-actions');
      const b = el('button', 'cmt-act', 'Reply'); b.type = 'button'; b.dataset.reply = c.id; b.dataset.replyName = c.author_name;
      actions.append(b); main.append(actions);
    }
    if (replies.length) {
      const wrap = el('div', 'cmt-replies');
      for (const r of replies) wrap.append(card(r, staff, open, []));
      main.append(wrap);
    }
    main.append(el('div', 'cmt-slot'));
  }
  d.append(avatar(c), main);
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
  if (document.querySelector('#comment-form.is-replying')) return; // don't pull the form out from under someone typing
  const open = list.dataset.open === '1', staff = list.dataset.staff ?? 'Team';
  const frag = document.createDocumentFragment();
  for (const c of rows.filter((r) => !r.parent_id)) frag.append(card(c, staff, open, rows.filter((x) => x.parent_id === c.id)));
  list.replaceChildren(frag);
  setCount(rows.length);
  if (location.hash.startsWith('#c-')) {
    const t = document.querySelector<HTMLElement>(location.hash);
    if (t) { t.classList.add('is-target'); t.scrollIntoView({ block: 'center' }); }
  }
}
function setCount(n: number) {
  const h = document.querySelector('#comments-h');
  if (h) h.textContent = n ? `${n} comment${n > 1 ? 's' : ''}` : 'Comments';
  document.querySelector<HTMLElement>('#cmt-empty')?.toggleAttribute('hidden', n > 0);
  document.querySelector<HTMLElement>('#cmt-write')?.toggleAttribute('hidden', n === 0);
}

export function initComments() {
  const form = document.querySelector<HTMLFormElement>('#comment-form');
  if (!form) return;
  const home = document.querySelector<HTMLElement>('#cmt-form-home')!;
  const err = form.querySelector<HTMLElement>('.form-error')!;
  const title = form.querySelector<HTMLElement>('.cmt-form-title')!;
  const cancel = form.querySelector<HTMLButtonElement>('#cancel-reply')!;
  const body = form.querySelector<HTMLTextAreaElement>('textarea')!;
  const count = form.querySelector<HTMLElement>('.cmt-count')!;
  const submit = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
  let parent: string | null = null;

  const setReply = (id: string | null, name = '') => {
    parent = id;
    form.classList.toggle('is-replying', !!id);
    cancel.hidden = !id;
    title.textContent = id ? `Reply to ${name}` : 'Leave a comment';
    submit.textContent = id ? 'Post reply' : 'Post comment';
    body.placeholder = id ? `Write your reply to ${name}…` : 'Share a question, a tip or your experience…';
    err.textContent = '';
    const slot = id ? document.querySelector(`#c-${CSS.escape(id)} .cmt-slot`) : home;
    (slot ?? home).append(form);
    if (id) { form.scrollIntoView({ behavior: 'smooth', block: 'center' }); body.focus({ preventScroll: true }); }
  };
  // Delegated, so it also works for comments loaded after the page was built.
  document.querySelector('#cmt-list')?.addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLButtonElement>('[data-reply]');
    if (b) setReply(b.dataset.reply!, b.dataset.replyName);
  });
  cancel.addEventListener('click', () => setReply(null));
  document.querySelector('#cmt-write')?.addEventListener('click', () => { setReply(null); form.scrollIntoView({ behavior: 'smooth', block: 'center' }); body.focus({ preventScroll: true }); });
  const updateCount = () => {
    const n = body.value.length;
    count.textContent = n > 2500 ? `${3000 - n} characters left` : '';
  };
  body.addEventListener('input', updateCount);

  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    err.textContent = '';
    const f = new FormData(form);
    submit.disabled = true;
    const label = submit.textContent; submit.textContent = 'Posting…';
    try {
      await rpc('submit_comment', {
        payload: { post_id: form.dataset.post, parent_id: parent, name: f.get('name'), email: f.get('email'), body: f.get('body'), website: f.get('website') },
      });
      const ok = el('div', 'cmt-ok');
      ok.setAttribute('role', 'status');
      ok.append(el('b', undefined, parent ? 'Thanks for your reply!' : 'Thanks for your comment!'),
        el('span', undefined, ' It will appear here once our team has checked it, usually within a day.'));
      form.replaceWith(ok);
    } catch (e) {
      err.textContent = commentError(e);
      submit.disabled = false; submit.textContent = label;
    }
  });
}
