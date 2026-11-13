// Admin > Analytics: the site's own visitor and lead numbers (from admin_analytics()).
import { useEffect, useState } from 'preact/hooks';
import { sb } from '../supabase';
import { fmtNum, fmtDate } from '../shared';

type N = number;
type Report = {
  days: N; since: string;
  kpi: { visitors: N; visitors_prev: N; sessions: N; sessions_prev: N; pageviews: N; pageviews_prev: N; leads: N; leads_prev: N;
    form_starts: N; contacts: N; contacts_prev: N; live: N; tracked_since: string | null };
  series: { day: string; visitors: N; pageviews: N; leads: N }[];
  pages: { path: string; views: N; visitors: N }[];
  landing: { path: string; sessions: N; leads: N }[];
  channels: { channel: string; sessions: N; visitors: N; leads: N }[];
  sources: { source: string; channel: string; sessions: N; leads: N }[];
  campaigns: { campaign: string; source: string | null; sessions: N; leads: N }[];
  devices: { device: string; sessions: N; leads: N }[];
  funnel: { sessions: N; started: N; sent: N };
  vendors: { id: string; name: string; slug: string; views: N; contacts: N; leads: N }[];
  lead_forms: { source: string; leads: N }[];
  lead_categories: { category: string; leads: N }[];
  lead_cities: { city: string; leads: N }[];
};

const PLUM = '#3A1D4A', ROSE = '#b83260', SOFT = '#e9b8c8';
const FORM_NAMES: Record<string, string> = { profile: 'Vendor page form', matched: 'Get matched', bulk: 'Request pricing (several vendors)' };
const pct = (a: N, b: N) => (b > 0 ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : '–');

function Change({ now, before }: { now: N; before: N }) {
  if (!before) return <small>&nbsp;</small>;
  const d = ((now - before) / before) * 100;
  const up = d >= 0;
  return <small style={`color:${up ? '#1f7a4d' : '#a3264f'};font-weight:600`}>{up ? '▲' : '▼'} {Math.abs(d).toFixed(0)}% vs previous {''}</small>;
}

function Bar({ value, max, color = ROSE }: { value: N; max: N; color?: string }) {
  return <span aria-hidden="true" style="display:block;height:6px;background:#f3eef5;border-radius:4px;margin-top:4px">
    <span style={`display:block;height:6px;width:${max ? Math.max(2, (value / max) * 100) : 0}%;background:${color};border-radius:4px`} /></span>;
}

function Trend({ s }: { s: Report['series'] }) {
  const W = 720, H = 220, pad = 28;
  const maxV = Math.max(1, ...s.map((d) => d.pageviews));
  const maxL = Math.max(1, ...s.map((d) => d.leads));
  const x = (i: N) => pad + (s.length > 1 ? (i * (W - pad * 2)) / (s.length - 1) : (W - pad * 2) / 2);
  const y = (v: N) => H - pad - (v / maxV) * (H - pad * 2);
  const line = (k: 'visitors' | 'pageviews') => s.map((d, i) => `${x(i)},${y(d[k])}`).join(' ');
  const bw = Math.max(2, Math.min(18, (W - pad * 2) / Math.max(1, s.length) - 3));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style="width:100%;height:auto" role="img"
      aria-label={`Daily page views, visitors and leads from ${s[0]?.day} to ${s.at(-1)?.day}`}>
      {[0, 0.5, 1].map((f) => <g><line x1={pad} x2={W - pad} y1={y(maxV * f)} y2={y(maxV * f)} stroke="#eee6f0" />
        <text x={pad - 6} y={y(maxV * f) + 4} font-size="11" text-anchor="end" fill="#8a8494">{Math.round(maxV * f)}</text></g>)}
      {s.map((d, i) => d.leads > 0 && <rect x={x(i) - bw / 2} y={H - pad - (d.leads / maxL) * 40} width={bw} height={(d.leads / maxL) * 40} fill={SOFT} rx="2">
        <title>{`${d.day}: ${d.leads} lead${d.leads === 1 ? '' : 's'}`}</title></rect>)}
      <polyline points={line('pageviews')} fill="none" stroke={PLUM} stroke-width="2" stroke-linejoin="round" />
      <polyline points={line('visitors')} fill="none" stroke={ROSE} stroke-width="2.5" stroke-linejoin="round" />
      {s.map((d, i) => <circle cx={x(i)} cy={y(d.visitors)} r="6" fill="transparent">
        <title>{`${d.day}: ${d.visitors} visitors, ${d.pageviews} page views, ${d.leads} leads`}</title></circle>)}
      <text x={pad} y={H - 8} font-size="11" fill="#8a8494">{fmtDate(s[0]?.day)}</text>
      <text x={W - pad} y={H - 8} font-size="11" fill="#8a8494" text-anchor="end">{fmtDate(s.at(-1)?.day)}</text>
    </svg>
  );
}

function Table<T>({ title, rows, cols, empty = 'No data yet for this period.' }: {
  title: string; rows: T[]; empty?: string;
  cols: { h: string; v: (r: T) => preact.ComponentChildren; num?: boolean }[];
}) {
  return (
    <section class="panel" style="min-width:0">
      <h2>{title}</h2>
      {rows.length === 0 ? <p class="muted" style="margin:0">{empty}</p> : (
        <div class="scroll-x"><table class="tbl">
          <thead><tr>{cols.map((c) => <th style={c.num ? 'text-align:right' : ''}>{c.h}</th>)}</tr></thead>
          <tbody>{rows.map((r) => <tr>{cols.map((c) => <td style={c.num ? 'text-align:right;white-space:nowrap' : ''}>{c.v(r)}</td>)}</tr>)}</tbody>
        </table></div>
      )}
    </section>
  );
}

export function Analytics() {
  const [days, setDays] = useState(30);
  const [r, setR] = useState<Report | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    setR(null); setErr('');
    sb().rpc('admin_analytics', { p_days: days }).then(({ data, error }) => (error ? setErr(error.message) : setR(data as Report)));
  }, [days]);

  const k = r?.kpi;
  const maxCh = Math.max(1, ...(r?.channels ?? []).map((c) => c.sessions));
  const maxPage = Math.max(1, ...(r?.pages ?? []).map((p) => p.views));
  const devTotal = (r?.devices ?? []).reduce((a, d) => a + d.sessions, 0);
  const sel = 'font:inherit;border:1px solid var(--ln);border-radius:10px;padding:0 12px;min-height:44px;background:#fff';

  return (
    <>
      <div class="dhead"><h1>Analytics</h1>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap">
          {k && <span class="chip-s s-tour" title="Visitors with a page open in the last 30 minutes">● {fmtNum(k.live)} on the site now</span>}
          <label style="display:flex;gap:8px;align-items:center;font-size:14px">Range
            <select value={days} onChange={(e) => setDays(Number(e.currentTarget.value))} style={sel}>
              <option value={1}>Today</option><option value={7}>Last 7 days</option><option value={30}>Last 30 days</option>
              <option value={90}>Last 90 days</option><option value={365}>Last 12 months</option>
            </select></label>
        </div>
      </div>
      {err && <p class="form-error">{err}</p>}
      {!r && !err && <p class="muted">Loading…</p>}
      {r && k && <>
        {k.tracked_since && k.tracked_since > r.since && <p class="muted" style="margin:0;font-size:13px">
          Visitor, source and device tracking started on {fmtDate(k.tracked_since)}; before that only page views and leads were recorded.</p>}
        <div class="kpis" aria-label="Key numbers">
          <div class="kpi"><span>Visitors</span><b>{fmtNum(k.visitors)}</b><Change now={k.visitors} before={k.visitors_prev} /></div>
          <div class="kpi"><span>Visits</span><b>{fmtNum(k.sessions)}</b><Change now={k.sessions} before={k.sessions_prev} /></div>
          <div class="kpi"><span>Page views</span><b>{fmtNum(k.pageviews)}</b><Change now={k.pageviews} before={k.pageviews_prev} /></div>
          <div class="kpi"><span>Leads</span><b>{fmtNum(k.leads)}</b><Change now={k.leads} before={k.leads_prev} /></div>
          <div class="kpi"><span>Visit → lead rate</span><b>{pct(r.funnel.sent, r.funnel.sessions)}</b><small>leads from tracked visits</small></div>
          <div class="kpi"><span>Calls, site & map clicks</span><b>{fmtNum(k.contacts)}</b><Change now={k.contacts} before={k.contacts_prev} /></div>
        </div>

        <section class="panel">
          <div class="dhead"><h2>Traffic and leads per day</h2>
            <div style="display:flex;gap:16px;font-size:13px;flex-wrap:wrap">
              <span><i style={`display:inline-block;width:14px;height:3px;background:${ROSE};vertical-align:middle`} /> Visitors</span>
              <span><i style={`display:inline-block;width:14px;height:3px;background:${PLUM};vertical-align:middle`} /> Page views</span>
              <span><i style={`display:inline-block;width:10px;height:10px;background:${SOFT};border-radius:2px`} /> Leads</span></div></div>
          <Trend s={r.series} />
        </section>

        <div class="row">
          <section class="panel grow">
            <h2>Where visits come from</h2>
            {r.channels.length === 0 ? <p class="muted" style="margin:0">No visits recorded yet for this period.</p> : (
              <table class="tbl"><thead><tr><th>Channel</th><th style="text-align:right">Visits</th><th style="text-align:right">Leads</th><th style="text-align:right">Lead rate</th></tr></thead>
                <tbody>{r.channels.map((c) => <tr><td><b>{c.channel}</b><Bar value={c.sessions} max={maxCh} /></td>
                  <td style="text-align:right">{fmtNum(c.sessions)}</td><td style="text-align:right">{fmtNum(c.leads)}</td>
                  <td style="text-align:right">{pct(c.leads, c.sessions)}</td></tr>)}</tbody></table>
            )}
          </section>
          <section class="panel side-col">
            <h2>Lead funnel</h2>
            {[['Visits', r.funnel.sessions], ['Started a request form', r.funnel.started], ['Sent a request', r.funnel.sent]].map(([l, n], i) => (
              <div><div style="display:flex;justify-content:space-between;font-size:14px"><b>{l}</b>
                <span>{fmtNum(n as N)}{i > 0 && <span class="muted"> · {pct(n as N, i === 1 ? r.funnel.sessions : r.funnel.started)}</span>}</span></div>
                <Bar value={n as N} max={Math.max(1, r.funnel.sessions)} color={i === 2 ? ROSE : i === 1 ? '#d77a9a' : PLUM} /></div>
            ))}
            <h2 style="margin-top:8px">Devices</h2>
            {r.devices.map((d) => <div><div style="display:flex;justify-content:space-between;font-size:14px">
              <b style="text-transform:capitalize">{d.device}</b><span>{pct(d.sessions, devTotal)} · {fmtNum(d.leads)} leads</span></div>
              <Bar value={d.sessions} max={devTotal} color={PLUM} /></div>)}
          </section>
        </div>

        <div class="row">
          <div class="grow" style="display:flex;flex-direction:column;gap:20px">
            <Table title="Top pages" rows={r.pages} cols={[
              { h: 'Page', v: (p) => <><a href={p.path} target="_blank" rel="noopener">{p.path}</a><Bar value={p.views} max={maxPage} color={PLUM} /></> },
              { h: 'Views', v: (p) => fmtNum(p.views), num: true }, { h: 'Visitors', v: (p) => fmtNum(p.visitors), num: true }]} />
            <Table title="Landing pages (first page of a visit)" rows={r.landing} cols={[
              { h: 'Page', v: (p) => <a href={p.path} target="_blank" rel="noopener">{p.path}</a> },
              { h: 'Visits', v: (p) => fmtNum(p.sessions), num: true }, { h: 'Leads', v: (p) => fmtNum(p.leads), num: true },
              { h: 'Lead rate', v: (p) => pct(p.leads, p.sessions), num: true }]} />
          </div>
          <div class="side-col" style="display:flex;flex-direction:column;gap:20px">
            <Table title="Top sources" rows={r.sources} cols={[
              { h: 'Source', v: (s) => <>{s.source}<span class="muted" style="display:block;font-size:12px">{s.channel}</span></> },
              { h: 'Visits', v: (s) => fmtNum(s.sessions), num: true }, { h: 'Leads', v: (s) => fmtNum(s.leads), num: true }]} />
            <Table title="Campaigns (utm_campaign)" rows={r.campaigns} empty="Add ?utm_source=…&utm_campaign=… to links in ads, emails and posts to see them here."
              cols={[{ h: 'Campaign', v: (c) => <>{c.campaign}<span class="muted" style="display:block;font-size:12px">{c.source}</span></> },
                { h: 'Visits', v: (c) => fmtNum(c.sessions), num: true }, { h: 'Leads', v: (c) => fmtNum(c.leads), num: true }]} />
          </div>
        </div>

        <Table title="Most viewed vendors" rows={r.vendors} cols={[
          { h: 'Vendor', v: (v) => <a href={`/vendor/${v.slug}/`} target="_blank" rel="noopener">{v.name}</a> },
          { h: 'Profile views', v: (v) => fmtNum(v.views), num: true }, { h: 'Calls, site & map clicks', v: (v) => fmtNum(v.contacts), num: true },
          { h: 'Leads received', v: (v) => fmtNum(v.leads), num: true }]} />

        <div class="row">
          <div class="side-col"><Table title="Leads by form" rows={r.lead_forms} cols={[
            { h: 'Form', v: (f) => FORM_NAMES[f.source] ?? f.source }, { h: 'Leads', v: (f) => fmtNum(f.leads), num: true }]} /></div>
          <div class="side-col"><Table title="Leads by vendor type" rows={r.lead_categories} cols={[
            { h: 'Vendor type', v: (c) => c.category }, { h: 'Leads', v: (c) => fmtNum(c.leads), num: true }]} /></div>
          <div class="side-col"><Table title="Leads by city" rows={r.lead_cities} cols={[
            { h: 'City', v: (c) => c.city }, { h: 'Leads', v: (c) => fmtNum(c.leads), num: true }]} /></div>
        </div>
        <p class="muted" style="font-size:12px;margin:0">Counted by the site itself, without cookies or IP addresses, so numbers differ a little from Google Analytics. Bots that announce themselves are left out.</p>
      </>}
    </>
  );
}
