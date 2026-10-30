import { useEffect, useState } from 'preact/hooks';
import { sb, must } from '../supabase';
import { fmtNum, type Ref } from '../shared';

type Stats = {
  leads: number; sent: number; clicks: number; views: number; reply_rate_24h: number | null; paid_vendors: number;
  series: { day: string; leads: number; replied: number }[];
  attention: Record<string, number>;
};
type PageRow = { city_id: number; category_id: number; vendor_count: number };

export function Overview({ ref_ }: { ref_: Ref }) {
  const [days, setDays] = useState(14);
  const [s, setS] = useState<Stats | null>(null);
  const [pages, setPages] = useState<PageRow[]>([]);
  const [minIndex, setMinIndex] = useState(5);
  const [err, setErr] = useState('');

  useEffect(() => {
    sb().rpc('admin_stats', { p_days: days }).then(({ data, error }) => (error ? setErr(error.message) : setS(data as Stats)));
  }, [days]);
  useEffect(() => {
    must<PageRow[]>(sb().from('page_counts').select('*').order('vendor_count', { ascending: false }).limit(12) as never).then(setPages);
    sb().from('settings').select('value').eq('key', 'min_vendors_to_index').maybeSingle().then(({ data }) => data && setMinIndex(Number((data as { value: number }).value)));
  }, []);

  if (err) return <p class="form-error">{err}</p>;
  const max = Math.max(1, ...(s?.series ?? []).map((d) => d.leads));
  const a = s?.attention ?? {};
  const todo = [
    ['Leads with no reply in 24h', a.unreplied_24h, '#leads', true],
    ['Leads with no matching vendor', a.unmatched_leads, '#leads', true],
    ['Listing claims to verify', a.pending_claims, '#vendors', false],
    ['Reviews to moderate', a.pending_reviews, '#reviews', false],
    ['Blog comments to moderate', a.pending_comments, '#comments', false],
    [`Thin pages (under ${minIndex} vendors)`, a.thin_pages, '#taxonomy', false],
    ['Vendors with no lead email', a.vendors_without_email, '#vendors', false],
  ] as [string, number | undefined, string, boolean][];

  return (
    <>
      <div class="dhead"><h1>Overview</h1>
        <label style="display:flex;gap:8px;align-items:center;font-size:14px">Range
          <select value={days} onChange={(e) => setDays(Number(e.currentTarget.value))} style="font:inherit;border:1px solid var(--ln);border-radius:10px;padding:0 12px;min-height:44px;background:#fff">
            <option value={7}>Last 7 days</option><option value={14}>Last 14 days</option><option value={30}>Last 30 days</option><option value={90}>Last 90 days</option>
          </select></label>
      </div>
      <div class="kpis" aria-label="Key numbers">
        <div class="kpi"><span>Leads</span><b>{fmtNum(s?.leads)}</b><small>excluding spam</small></div>
        <div class="kpi"><span>Leads sent to vendors</span><b>{fmtNum(s?.sent)}</b><small>{s && s.leads ? `${(s.sent / s.leads).toFixed(1)} per lead` : ''}</small></div>
        <div class="kpi"><span>Clicks (phone, site, directions)</span><b>{fmtNum(s?.clicks)}</b><small>on vendor profiles</small></div>
        <div class="kpi"><span>Profile views</span><b>{fmtNum(s?.views)}</b><small>&nbsp;</small></div>
        <div class="kpi"><span>Vendor reply rate (24h)</span><b>{s?.reply_rate_24h != null ? `${s.reply_rate_24h}%` : '–'}</b><small>leads older than 24h</small></div>
        <div class="kpi"><span>Featured vendors</span><b>{fmtNum(s?.paid_vendors)}</b><small>paying plan</small></div>
      </div>
      <div class="row">
        <section class="panel grow">
          <div class="dhead"><h2>Leads per day</h2>
            <div style="display:flex;gap:16px;font-size:13px"><span><i style="display:inline-block;width:10px;height:10px;background:#b83260;border-radius:3px" /> Leads</span><span><i style="display:inline-block;width:10px;height:10px;background:#e9b8c8;border-radius:3px" /> Replied within 24h</span></div></div>
          <div role="img" aria-label={`Leads per day over the last ${days} days`} style="height:200px;display:flex;align-items:flex-end;gap:4px;border-bottom:1px solid var(--ln)">
            {(s?.series ?? []).map((d) => (
              <div title={`${d.day}: ${d.leads} leads, ${d.replied} replied within 24h`} style={`flex:1;height:${(d.leads / max) * 100}%;background:#b83260;border-radius:4px 4px 0 0;display:flex;align-items:flex-end;min-height:${d.leads ? 2 : 0}px`}>
                <div style={`width:100%;height:${d.leads ? (d.replied / d.leads) * 100 : 0}%;background:#e9b8c8`} />
              </div>
            ))}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:12px" class="muted"><span>{s?.series[0]?.day}</span><span>{s?.series.at(-1)?.day}</span></div>
        </section>
        <section class="panel side-col">
          <h2>Needs attention</h2>
          {todo.map(([label, n, href, urgent]) => (
            <a href={href} class="result" style={`text-decoration:none;background:${urgent && n ? '#fbedef' : '#fff'}`}>
              <span style="font-size:14px;font-weight:600">{label}</span><b style={`color:${urgent && n ? '#a3264f' : 'inherit'}`}>{fmtNum(n ?? 0)}</b>
            </a>
          ))}
        </section>
      </div>
      <section class="panel">
        <h2>Biggest city × category pages</h2>
        <div class="scroll-x"><table class="tbl" style="min-width:560px">
          <thead><tr><th>Page</th><th>Vendors</th><th>Google</th></tr></thead>
          <tbody>{pages.map((p) => {
            const c = ref_.cityById.get(p.city_id); const cat = ref_.catById.get(p.category_id);
            return <tr><td><b>{c?.label}</b> · {cat?.name}</td><td>{p.vendor_count}</td>
              <td><span class={`chip-s ${p.vendor_count >= minIndex ? 's-tour' : 's-pending'}`}>{p.vendor_count >= minIndex ? 'Indexable' : 'Thin · noindex'}</span></td></tr>;
          })}</tbody>
        </table></div>
      </section>
    </>
  );
}
