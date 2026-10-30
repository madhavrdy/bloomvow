import { useEffect, useState } from 'preact/hooks';
import { sb, must, friendly } from '../supabase';
import { ago, fmtDate, Toast, useToast } from '../shared';

type R = { id: string; author_name: string; author_email: string | null; rating: number; body: string; wedding_date: string | null; status: string; created_at: string; vendors: { name: string; slug: string } };

export function Reviews({ onChange }: { onChange: () => void }) {
  const [status, setStatus] = useState('pending');
  const [rows, setRows] = useState<R[] | null>(null);
  const [toast, setToast] = useToast();
  async function load() {
    setRows(await must<R[]>(sb().from('reviews').select('id,author_name,author_email,rating,body,wedding_date,status,created_at,vendors(name,slug)')
      .eq('status', status).order('created_at', { ascending: status !== 'pending' ? false : true }).limit(200) as never));
  }
  useEffect(() => { load(); }, [status]);
  async function decide(r: R, ok: boolean) {
    const { error } = await sb().rpc('admin_moderate_review', { p_review: r.id, p_approve: ok });
    if (error) return setToast(friendly(error));
    setToast(ok ? 'Review published, rating updated' : 'Review rejected');
    load(); onChange();
  }
  return (
    <>
      <div class="dhead"><h1>Reviews</h1>
        <div class="seg" role="group" aria-label="Review status">
          {['pending', 'approved', 'rejected'].map((s) => <button type="button" aria-pressed={status === s} onClick={() => setStatus(s)}>{s[0].toUpperCase() + s.slice(1)}</button>)}
        </div></div>
      {!rows ? <p class="muted">Loading…</p> : rows.length === 0 ? <div class="panel"><p class="empty">No {status} reviews.</p></div> : rows.map((r) => (
        <section class="panel" aria-label={`Review by ${r.author_name}`}>
          <div class="dhead" style="align-items:flex-start">
            <div><b>{'★'.repeat(r.rating)}{'☆'.repeat(5 - r.rating)}</b> <b style="margin-left:6px">{r.author_name}</b>
              <span class="muted" style="display:block;font-size:13px">for <a href={`/vendor/${r.vendors.slug}/`} target="_blank" rel="noopener">{r.vendors.name}</a> · {ago(r.created_at)}{r.wedding_date ? ` · married ${fmtDate(r.wedding_date)}` : ''}{r.author_email ? ` · ${r.author_email}` : ''}</span></div>
            {status !== 'approved' && <button class="btn btn-green btn-sm" onClick={() => decide(r, true)}>Approve</button>}
          </div>
          <p style="margin:0;line-height:1.6">{r.body}</p>
          {status !== 'rejected' && <button class="btn btn-outline btn-sm" style="align-self:flex-start" onClick={() => decide(r, false)}>{status === 'approved' ? 'Unpublish' : 'Reject'}</button>}
        </section>
      ))}
      <Toast text={toast} />
    </>
  );
}
