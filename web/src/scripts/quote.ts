import { rpc, friendlyError, ApiError } from './api';
import { leadSubmitted, watchLeadForm, leadError } from './lead-events';
import { leadPayload, leadProblem, dateProblem } from './lead';

// Map "Austin, TX" -> city id via the build-time city list.
async function cityList(): Promise<{ id: number; name: string; url: string }[]> {
  const res = await fetch('/data/cities.json');
  return res.json();
}

export function validateStep(step: number, fd: FormData, cityId: number | null): string | null {
  if (step === 1 && fd.getAll('category').length === 0) return 'Please pick at least one type of vendor.';
  if (step === 2) {
    if (!cityId) return 'Please choose your wedding city from the list.';
    const d = dateProblem(fd);
    if (d) return d;
    const g = String(fd.get('guests') ?? '').trim();
    if (g && !(/^\d+$/.test(g) && Number(g) >= 1 && Number(g) <= 3000)) return 'Please enter a guest count between 1 and 3,000.';
  }
  if (step === 4) {
    const bad = leadProblem(fd);
    if (bad) return bad[1];
  }
  return null;
}

export function initQuote() {
  const form = document.getElementById('quote') as HTMLFormElement | null;
  if (!form) return;
  const steps = [...form.querySelectorAll<HTMLFieldSetElement>('fieldset[data-step]')];
  const back = document.getElementById('back')!;
  const next = document.getElementById('next') as HTMLButtonElement;
  const note = document.getElementById('free-note')!;
  const err = document.getElementById('quote-error')!;
  const cityInput = document.getElementById('city-name') as HTMLInputElement;
  const params = new URLSearchParams(location.search);
  const bulk = params.get('mode') === 'bulk';
  const formName = bulk ? 'request_pricing' : 'get_matched';
  watchLeadForm(form, formName);
  let step = 1;
  let cities: { id: number; name: string; url: string }[] = [];
  let cityId: number | null = null;

  const citiesReady = cityList().then((list) => {
    cities = list;
    const dl = document.getElementById('cities')!;
    for (const c of list) { const o = document.createElement('option'); o.value = c.name; dl.appendChild(o); }
    const pre = Number(params.get('city'));
    const found = list.find((c) => c.id === pre);
    if (found) { cityInput.value = found.name; cityId = found.id; }
  });
  const syncCity = () => {
    const v = cityInput.value.trim().toLowerCase();
    const c = cities.find((x) => x.name.toLowerCase() === v) ?? cities.find((x) => x.name.toLowerCase().split(',')[0] === v);
    cityId = c ? c.id : null;
  };
  cityInput.addEventListener('input', syncCity);
  cityInput.addEventListener('change', syncCity);

  const pre = params.get('cat');
  if (pre) form.querySelectorAll<HTMLInputElement>('input[name=category]').forEach((i) => { if (i.dataset.slug === pre) i.checked = true; });

  const show = () => {
    steps.forEach((s) => (s.hidden = Number(s.dataset.step) !== step));
    back.hidden = step === 1;
    note.hidden = step !== 1;
    next.textContent = step === 4 ? 'Send to matching vendors' : 'Continue';
    document.getElementById('step-label')!.textContent = `Step ${step} of 4`;
    (document.getElementById('bar-fill') as HTMLElement).style.width = `${step * 25}%`;
    err.textContent = '';
    steps[step - 1].querySelector<HTMLElement>('input, select, textarea')?.focus({ preventScroll: true });
  };
  back.addEventListener('click', () => { step = Math.max(1, step - 1); show(); });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await citiesReady;
    syncCity();
    const fd = new FormData(form);
    const problem = validateStep(step, fd, cityId);
    if (problem) { err.textContent = problem; leadError(formName, problem, step); return; }
    if (step < 4) { step += 1; show(); return; }

    next.disabled = true;
    const cats = fd.getAll('category').map(Number);
    try {
      const payload = leadPayload(fd, { source: bulk && cats.length === 1 ? 'bulk' : 'matched', city_id: cityId, category_ids: cats });
      const res = await rpc<{ matched: number }>('submit_lead', { payload });
      const city = cities.find((c) => c.id === cityId)!;
      leadSubmitted(form, {
        form: formName, vendors: res.matched, city: city.name,
        categories: [...form.querySelectorAll<HTMLInputElement>('[name=category]:checked')].map((i) => i.dataset.slug || i.value),
      });
      form.hidden = true;
      document.getElementById('progress')!.hidden = true;
      const done = document.getElementById('done')!;
      done.hidden = false;
      document.getElementById('done-title')!.textContent = res.matched > 0 ? `Request sent to ${res.matched} vendors` : 'Request received';
      document.getElementById('done-text')!.textContent = res.matched > 0
        ? `We sent your details to vendors in and around ${city.name} who fit your request. Most reply within a day; we'll email you a link to read and answer their replies in your inbox here.`
        : `We don't have a matching vendor in ${city.name} yet. Our team will look for vendors who fit and get back to you by email.`;
      const link = document.getElementById('done-link') as HTMLAnchorElement;
      link.href = city.url; link.textContent = `Browse ${city.name.split(',')[0]} vendors`;
      done.focus();
    } catch (ex) {
      err.textContent = friendlyError(ex);
      leadError(formName, ex instanceof ApiError ? ex.code : 'network');
      next.disabled = false;
    }
  });
  show();
}
