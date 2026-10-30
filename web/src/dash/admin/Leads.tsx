import { useEffect, useMemo, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { ago, fmtDate, bandLabel, Toast, useToast, type Ref } from '../shared';

type Recipient = { vendor_id: string; status: string; sent_at: string; opened_at: string | null; replied_at: string | null; reminded_at: string | null; vendors: { name: string; plan: string } };
type Lead = {
  id: string; created_at: string; source: string; couple_name: string; email: string; phone: string | null; wedding_date: string | null;
  guests: number | null; city_id: number; budget_band: number | null; message: string | null; category_ids: number[]; status: string;
  lead_recipients: Recipient[];
};

export function leadState(l: Pick<Lead, 'status' | 'lead_recipients'>): { label: string; cls: string } {
  if (l.status === 'spam') return { label: 'Spam', cls: 's-lost' };
  if (l.status === 'unmatched' || !l.lead_recipients.length) return { label: 'No match', cls: 's-pending' };
  const rs = l.lead_recipients;
  if (rs.some((r) => r.status === 'booked')) return { label: 'Booked', cls: 's-booked' };
  if (rs.some((r) => r.replied_at)) return { label: 'Replied', cls: 's-tour' };
  if (rs.every((r) => Date.now() - new Date(r.sent_at).getTime() > 24 * 3600e3)) return { label: 'No reply 24h+', cls: 's-new' };
  return { label: 'New', cls: 's-replied' };
}

const SOURCES: Record<string, string> = { profile: 'Profile form', matched: 'Get matched', bulk: 'Request from several' };

export function Leads({ ref_ }: { ref_: Ref }) {
  const [rows, setRows] = useState<Lead[] | null>(null);
  const [q, setQ] = useState('');
  const [state, setState] = useState('all');
  const [source, setSource] = useState('all');
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useToast();

  async function load() {
    const data = await must<Lead[]>(sb().from('leads')
      .select('*, lead_recipients(vendor_id,status,sent_at,opened_at,replied_at,reminded_at,vendors(name,plan))')
      .order('created_at', { ascending: false }).limit(500) as never);
    setRows(data);
  }
  useEffect(() => { load(); }, []);

  const shown = useMemo(() => (rows ?? []).filter((l) => {
    const t = q.trim().toLowerCase();
    if (t && !(`${l.couple_name} ${l.email} ${l.lead_recipients.map((r) => r.vendors.name).join(' ')}`.toLowerCase().includes(t))) return false;
    if (source !== 'all' && l.source !== source) return false;
    if (state !== 'all' && leadState(l).label !== state) return false;
    return true;
  }), [rows, q, state, source]);
  const cur = rows?.find((l) => l.id === sel);

  async function act(fn: string, args: Record<string, unknown>, msg: (d: unknown) => string) {
    setBusy(true);
    try {
      const { data, error } = await sb().rpc(fn, args);
      if (error) throw error;
      await load();
      setToast(msg(data));
    } catch (e) { setToast(friendly(e)); } finally { setBusy(false); }
  }

  if (!rows) return <p class="muted">Loading leads…</p>;
  const sel_ = { font: 'inherit', fontSize: '14px', border: '1px solid var(--ln)', borderRadius: '10px', padding: '0 12px', minHeight: '44px', background: '#fff' };
  return (
    <>
      <div class="dhead"><h1>Leads</h1><span class="muted">{shown.length} of {rows.length}</span></div>
      <div style="display:flex;flex-wrap:wrap;gap:10px">
        <label style="flex:2 1 240px"><span class="sr-only">Search leads</span><input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} placeholder="Search couple, email or vendor" style={{ ...sel_, width: '100%' }} /></label>
        <label><span class="sr-only">Status</span><select value={state} onChange={(e) => setState(e.currentTarget.value)} style={sel_}>
          {['all', 'New', 'No reply 24h+', 'Replied', 'Booked', 'No match', 'Spam'].map((s) => <option value={s}>{s === 'all' ? 'All statuses' : s}</option>)}</select></label>
        <label><span class="sr-only">Source</span><select value={source} onChange={(e) => setSource(e.currentTarget.value)} style={sel_}>
          <option value="all">All sources</option>{Object.entries(SOURCES).map(([k, v]) => <option value={k}>{v}</option>)}</select></label>
      </div>
      <div class="inbox">
        <section class="panel" style="flex:999 1 560px;padding:0;overflow:hidden">
          <div class="scroll-x"><table class="tbl" style="min-width:680px">
            <thead><tr><th style="padding-left:16px">Couple</th><th>Wedding</th><th>Needs</th><th>Budget</th><th>Sent / replied</th><th>Status</th></tr></thead>
            <tbody>
              {shown.length === 0 && <tr><td colSpan={6} class="empty">No leads match.</td></tr>}
              {shown.map((l) => {
                const st = leadState(l);
                return (
                  <tr style={`cursor:pointer;background:${l.id === sel ? '#fbf6f8' : ''}`} onClick={() => setSel(l.id)}>
                    <td style="padding-left:16px"><button type="button" class="linkbtn" style="color:var(--ink);text-decoration:none;font-weight:700" onClick={() => setSel(l.id)}>{l.couple_name}</button>
                      <span class="muted" style="display:block;font-size:12px">{ago(l.created_at)} · {SOURCES[l.source]}</span></td>
                    <td>{l.wedding_date ? fmtDate(l.wedding_date) : 'Flexible'}<span class="muted" style="display:block;font-size:12px">{ref_.cityById.get(l.city_id)?.label}{l.guests ? ` · ${l.guests} guests` : ''}</span></td>
                    <td>{l.category_ids.map((c) => ref_.catById.get(c)?.singular.replace(/^Wedding /, '')).join(', ')}</td>
                    <td>{bandLabel(ref_.bands, l.budget_band)}</td>
                    <td><b>{l.lead_recipients.length} / {l.lead_recipients.filter((r) => r.replied_at).length}</b></td>
                    <td><span class={`chip-s ${st.cls}`}>{st.label}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </section>
        {cur && (
          <aside class="panel" style="flex:1 1 320px;max-width:420px" aria-label="Lead detail">
            <div class="dhead" style="align-items:flex-start">
              <div><b style="font-size:18px;display:block">{cur.couple_name}</b><span class="muted" style="font-size:13px">{cur.email}{cur.phone ? ` · ${cur.phone}` : ''}</span></div>
              <span class={`chip-s ${leadState(cur).cls}`}>{leadState(cur).label}</span>
            </div>
            <div class="facts4">
              <div><span>Date</span><b>{cur.wedding_date ? fmtDate(cur.wedding_date) : 'Flexible'}</b></div>
              <div><span>Guests</span><b>{cur.guests ?? '–'}</b></div>
              <div><span>City</span><b>{ref_.cityById.get(cur.city_id)?.label}</b></div>
              <div><span>Budget</span><b>{bandLabel(ref_.bands, cur.budget_band)}</b></div>
            </div>
            {cur.message && <div class="msg">{cur.message}</div>}
            <b style="font-size:14px">Routing log</b>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
              <div><span class="muted">{fmtDate(cur.created_at)}</span> · Submitted via {SOURCES[cur.source]}</div>
              {cur.lead_recipients.length === 0 && <div class="form-error" style="font-size:13px">No vendor matched. Re-route after adding vendors in this city.</div>}
              {cur.lead_recipients.map((r) => (
                <div style="display:flex;justify-content:space-between;gap:8px;border-top:1px solid var(--ln);padding-top:8px">
                  <span><b>{r.vendors.name}</b>{r.vendors.plan === 'featured' && ' ★'}
                    <span class="muted" style="display:block">sent {ago(r.sent_at)}{r.opened_at ? ' · opened' : ''}{r.reminded_at ? ' · reminded' : ''}</span></span>
                  <span class={`chip-s s-${r.status}`} style="align-self:flex-start">{r.replied_at ? (r.status === 'replied' ? 'Replied' : r.status) : 'No reply'}</span>
                </div>
              ))}
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;border-top:1px solid var(--ln);padding-top:14px">
              <button class="btn btn-primary" disabled={busy || cur.status === 'spam'} onClick={() => act('admin_reroute_lead', { p_lead: cur.id, p_extra: 3 }, (n) => (n ? `Sent to ${n} more vendor${n === 1 ? '' : 's'}` : 'No other matching vendors found'))}>Send to 3 more vendors</button>
              <button class="btn btn-outline" disabled={busy} onClick={() => act('admin_mark_spam', { p_lead: cur.id, p_spam: cur.status !== 'spam' }, () => (cur.status === 'spam' ? 'Marked as not spam' : 'Marked as spam'))}>{cur.status === 'spam' ? 'Not spam' : 'Mark as spam'}</button>
            </div>
          </aside>
        )}
      </div>
      <Toast text={toast} />
    </>
  );
}
