import { rpc, track, conversion, friendlyError, ApiError } from './api';
import { leadPayload, showSent, leadProblem } from './lead';

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
    const bad = leadProblem(new FormData(form));
    if (bad) {
      err.textContent = bad[1];
      const field = form.querySelector<HTMLInputElement>(`[name=${bad[0]}]`);
      field?.setAttribute('aria-invalid', 'true'); field?.focus();
      return;
    }
    form.querySelectorAll('[aria-invalid]').forEach((el) => el.removeAttribute('aria-invalid'));
    btn.disabled = true;
    try {
      const payload = leadPayload(new FormData(form), { source: 'profile', vendor_id: vendorId, city_id: Number(form.dataset.city) });
      const res = await rpc<{ matched: number }>('submit_lead', { payload });
      conversion('lead', { form: 'vendor_profile', vendors: res.matched });
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
    } catch (ex) {
      const code = ex instanceof ApiError ? ex.code : '';
      err.textContent = ({
        already_reviewed: "You've already reviewed this vendor. Thank you!",
        rate_limited: "You've sent several reviews today. Please try again tomorrow.",
        invalid_email: 'Please enter a valid email address.',
        name_required: 'Please enter your name.',
        invalid_rating: 'Please choose a star rating.',
      } as Record<string, string>)[code] ?? 'Please check your review (at least 20 characters) and try again.';
    }
  });
}
