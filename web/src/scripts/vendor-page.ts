import { rpc, track, friendlyError } from './api';
import { leadPayload, showSent } from './lead';

export function initVendorPage() {
  const page = document.querySelector<HTMLElement>('[data-vendor-page]');
  if (!page) return;
  const vendorId = page.dataset.vendorPage!;
  track(vendorId, 'view');
  document.querySelectorAll<HTMLElement>('[data-track]').forEach((el) =>
    el.addEventListener('click', () => track(vendorId, el.dataset.track!)));

  const form = document.getElementById('lead-form') as HTMLFormElement | null;
  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const err = form.querySelector('.form-error')!;
    const btn = form.querySelector<HTMLButtonElement>('button[type=submit]')!;
    err.textContent = '';
    btn.disabled = true;
    try {
      const payload = leadPayload(new FormData(form), { source: 'profile', vendor_id: vendorId, city_id: Number(form.dataset.city) });
      const res = await rpc<{ matched: number }>('submit_lead', { payload });
      showSent(form, res.matched);
    } catch (ex) {
      err.textContent = friendlyError(ex);
      btn.disabled = false;
    }
  });

  const review = document.getElementById('review-form') as HTMLFormElement | null;
  review?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(review);
    const err = review.querySelector('.form-error')!;
    try {
      await rpc('submit_review', {
        p_vendor: vendorId, p_name: fd.get('name'), p_email: fd.get('email'),
        p_wedding_date: fd.get('date') || null, p_rating: Number(fd.get('rating')), p_body: fd.get('body'),
      });
      review.innerHTML = '<p class="form-ok">Thanks! Your review will appear once it has been checked.</p>';
    } catch {
      err.textContent = 'Please check your review (at least 20 characters) and try again.';
    }
  });
}
