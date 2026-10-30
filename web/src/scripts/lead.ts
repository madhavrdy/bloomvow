// Shared lead-form helpers (vendor profile form and the Get matched flow).

export function leadPayload<E extends Record<string, unknown>>(fd: FormData, extra: E) {
  const s = (k: string) => {
    const v = fd.get(k);
    return v == null ? '' : String(v).trim();
  };
  return {
    couple_name: s('couple_name'),
    email: s('email'),
    phone: s('phone') || null,
    wedding_date: s('wedding_date') || null,
    date_flexible: fd.get('date_flexible') === 'on',
    guests: s('guests') ? Number(s('guests')) : null,
    budget_band: s('budget_band') !== '' ? Number(s('budget_band')) : null,
    message: s('message') || null,
    also_similar: fd.get('also_similar') === 'on',
    website: s('website'),   // honeypot
    ...extra,
  };
}

export function showSent(form: HTMLElement, matched: number) {
  const n = Math.max(matched, 1);
  form.innerHTML = `<div class="form-ok" role="status"><b style="font-size:18px">Request sent${n > 1 ? ` to ${n} vendors` : ''}!</b>
    <p style="margin:8px 0 0">Vendors reply by email, usually within a day. Check your inbox (and spam folder) for their replies.</p></div>`;
}
