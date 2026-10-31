// Blog comment form: posts to submit_comment; every comment waits for moderation.
import { rpc, ApiError } from './api';

const messages: Record<string, string> = {
  invalid_email: 'Please enter a valid email address.',
  name_required: 'Please enter your name.',
  invalid_body: 'Please write a comment (2 to 3,000 characters).',
  too_many_links: 'Please include at most one link.',
  comments_closed: 'Comments are closed for this article.',
  rate_limited: "You've posted several comments recently. Please try again later.",
};
export const commentError = (e: unknown) => (e instanceof ApiError && messages[e.code]) || 'Something went wrong posting your comment. Please try again.';

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
  document.querySelectorAll<HTMLButtonElement>('[data-reply]').forEach((b) => b.addEventListener('click', () => setReply(b.dataset.reply!, b.dataset.replyName)));
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
