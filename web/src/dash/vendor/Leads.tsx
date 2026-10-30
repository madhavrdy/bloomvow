import { useEffect, useMemo, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { ago, fmtDate, bandLabel, Toast, useToast, type Ref } from '../shared';
import { statusLabel } from './Overview';
import type { Listing } from './VendorApp';

export type LeadItem = {
  lead_id: string; vendor_id: string; status: string; sent_at: string; opened_at: string | null; replied_at: string | null; reply: string | null;
  leads: { couple_name: string; email: string; phone: string | null; wedding_date: string | null; date_flexible: boolean; guests: number | null;
    budget_band: number | null; message: string | null; source: string; city_id: number; created_at: string };
};

// Quick-reply templates; [BRACKETS] are for the vendor to fill in.
export function templates(first: string, date: string, business: string) {
  return [
    { label: 'Date is open', text: `Hi ${first}! Thanks for reaching out to ${business}. Good news: ${date} is currently open. I'd love to share our packages and pricing. Would you like to set up a call or a visit this week?` },
    { label: 'Book a tour', text: `Hi ${first}, thank you for your message! You can pick a time to visit or chat here: [YOUR BOOKING LINK]. Looking forward to meeting you.` },
    { label: 'Date taken', text: `Hi ${first}, thank you for thinking of ${business}. Unfortunately ${date} is already booked, but we do have these nearby dates open: [DATES]. Would any of those work?` },
  ];
}

const sourceLabel = (s: string) => ({ profile: 'your profile', matched: 'Get matched', bulk: 'Request from several' } as Record<string, string>)[s] ?? s;

export function Leads({ listing, ref_, onChange }: { listing: Listing; ref_: Ref; onChange: () => void }) {
  const [items, setItems] = useState<LeadItem[] | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [filter, setFilter] = useState('all');
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useToast();

  async function load() {
    const rows = await must<LeadItem[]>(sb().from('lead_recipients')
      .select('lead_id,vendor_id,status,sent_at,opened_at,replied_at,reply,leads(couple_name,email,phone,wedding_date,date_flexible,guests,budget_band,message,source,city_id,created_at)')
      .eq('vendor_id', listing.id).order('sent_at', { ascending: false }).limit(500) as never);
    setItems(rows);
    return rows;
  }
  useEffect(() => { load().then((rows) => rows[0] && open(rows[0].lead_id, rows)); }, [listing.id]);

  const shown = useMemo(() => (items ?? []).filter((i) => filter === 'all' || (filter === 'open' ? i.status === 'new' : i.status === filter)), [items, filter]);
  const cur = items?.find((i) => i.lead_id === sel) ?? null;

  function open(id: string, rows = items ?? []) {
    setSel(id); setReply(''); setErr('');
    const it = rows.find((r) => r.lead_id === id);
    if (it && !it.opened_at) {
      sb().rpc('mark_lead_opened', { p_lead: id, p_vendor: listing.id }).then(() => {
        setItems((xs) => xs?.map((x) => (x.lead_id === id ? { ...x, opened_at: new Date().toISOString() } : x)) ?? null);
      });
    }
  }

  async function update(status: string | null, text: string | null) {
    if (!cur) return;
    setBusy(true); setErr('');
    try {
      const { error } = await sb().rpc('vendor_reply', { p_lead: cur.lead_id, p_vendor: listing.id, p_reply: text, p_status: status });
      if (error) throw error;
      await load();
      setReply('');
      setToast(text ? `Reply sent to ${cur.leads.couple_name}` : `Marked as ${statusLabel(status!).toLowerCase()}`);
      onChange();
    } catch (ex) { setErr(friendly(ex)); } finally { setBusy(false); }
  }

  if (!items) return <p class="muted">Loading leads…</p>;
  const first = cur?.leads.couple_name.split(/\s|&/)[0] ?? '';
  const date = cur?.leads.wedding_date ? fmtDate(cur.leads.wedding_date) : 'your date';
  const counts = { all: items.length, open: items.filter((i) => i.status === 'new').length };
  return (
    <>
      <div class="dhead"><h1>Leads</h1>
        <div class="seg" role="group" aria-label="Filter leads">
          {[['all', `All (${counts.all})`], ['open', `Needs reply (${counts.open})`], ['tour', 'Tours'], ['booked', 'Booked']].map(([k, l]) => (
            <button type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}>{l}</button>
          ))}
        </div>
      </div>
      {items.length === 0 ? <div class="panel"><p class="empty">No leads yet. When couples request pricing from you, they'll appear here and in your email.</p></div> : (
        <div class="inbox">
          <section class="inbox-list" aria-label="Lead list">
            {shown.length === 0 && <p class="empty">Nothing here.</p>}
            {shown.map((i) => (
              <button type="button" aria-current={i.lead_id === sel ? 'true' : undefined} class={i.opened_at ? '' : 'unread'} onClick={() => open(i.lead_id)}>
                <span style="display:flex;justify-content:space-between;gap:8px;width:100%"><b style="font-size:15px">{i.leads.couple_name}</b><span class="muted" style="font-size:12px">{ago(i.sent_at)}</span></span>
                <span class="muted" style="font-size:13px">{i.leads.wedding_date ? fmtDate(i.leads.wedding_date) : 'Date flexible'}{i.leads.guests ? ` · ${i.leads.guests} guests` : ''}</span>
                <span class={`chip-s s-${i.status}`} style="align-self:flex-start">{statusLabel(i.status)}</span>
              </button>
            ))}
          </section>
          {cur && (
            <section class="panel" style="flex:999 1 420px" aria-label="Lead detail">
              <div class="dhead" style="align-items:flex-start">
                <div><b style="font-size:22px;display:block">{cur.leads.couple_name}</b>
                  <span class="muted" style="font-size:14px">Sent via {sourceLabel(cur.leads.source)} · {ago(cur.sent_at)}</span></div>
                <div style="display:flex;gap:8px;flex-wrap:wrap">
                  {cur.leads.phone && <a class="btn btn-outline btn-sm" href={`tel:${cur.leads.phone}`}>Call {cur.leads.phone}</a>}
                  <a class="btn btn-outline btn-sm" href={`mailto:${cur.leads.email}?subject=${encodeURIComponent(`Your wedding inquiry with ${listing.name}`)}`}>Email {cur.leads.email}</a>
                </div>
              </div>
              <div class="facts4">
                <div><span>Date</span><b>{cur.leads.wedding_date ? fmtDate(cur.leads.wedding_date) : 'Not set'}{cur.leads.date_flexible ? ' (flexible)' : ''}</b></div>
                <div><span>Guests</span><b>{cur.leads.guests ?? 'Not given'}</b></div>
                <div><span>Total budget</span><b>{bandLabel(ref_.bands, cur.leads.budget_band)}</b></div>
                <div><span>City</span><b>{ref_.cityById.get(cur.leads.city_id)?.label ?? ''}</b></div>
              </div>
              {cur.leads.message && <div class="msg">{cur.leads.message}</div>}
              {cur.reply && <div class="msg" style="background:var(--acc-soft)"><b style="display:block;margin-bottom:4px">Your reply · {cur.replied_at && ago(cur.replied_at)}</b>{cur.reply}</div>}
              <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <span class="muted" style="font-size:13px;font-weight:600">Quick replies:</span>
                {templates(first, date, listing.name).map((t) => <button type="button" class="btn btn-outline btn-sm" onClick={() => setReply(t.text)}>{t.label}</button>)}
              </div>
              <label class="field">{cur.reply ? 'Send another message' : 'Your reply'}
                <textarea rows={5} value={reply} onInput={(e) => setReply(e.currentTarget.value)} placeholder="Couples who get a reply within an hour are far more likely to book a visit." />
              </label>
              {err && <p class="form-error" role="alert">{err}</p>}
              <div class="dhead">
                <div class="seg" role="group" aria-label="Lead status">
                  {['tour', 'booked', 'lost'].map((st) => (
                    <button type="button" aria-pressed={cur.status === st} disabled={busy} onClick={() => update(st, null)}>{statusLabel(st)}</button>
                  ))}
                </div>
                <button type="button" class="btn btn-acc btn-lg" disabled={busy || !reply.trim()} onClick={() => update(null, reply)}>Send reply</button>
              </div>
              <p class="muted" style="margin:0;font-size:12px">Your reply is emailed to the couple from us, with your email as the reply-to address.</p>
            </section>
          )}
        </div>
      )}
      <Toast text={toast} />
    </>
  );
}
