// Small charts shared by Admin > Analytics and the vendor Analytics page.
import { fmtDate } from './shared';

type N = number;
export const PLUM = '#3A1D4A', ROSE = '#b83260', SOFT = '#e9b8c8';
export const pct = (a: N, b: N) => (b > 0 ? `${((a / b) * 100).toFixed(a / b < 0.1 ? 1 : 0)}%` : '–');

export function Change({ now, before }: { now: N; before: N }) {
  if (!before) return <small>&nbsp;</small>;
  const d = ((now - before) / before) * 100;
  const up = d >= 0;
  return <small style={`color:${up ? '#1f7a4d' : '#a3264f'};font-weight:600`}>{up ? '▲' : '▼'} {Math.abs(d).toFixed(0)}% vs previous {''}</small>;
}

export function Bar({ value, max, color = ROSE }: { value: N; max: N; color?: string }) {
  return <span aria-hidden="true" style="display:block;height:6px;background:#f3eef5;border-radius:4px;margin-top:4px">
    <span style={`display:block;height:6px;width:${max ? Math.max(2, (value / max) * 100) : 0}%;background:${color};border-radius:4px`} /></span>;
}

export type TrendPoint = { day: string; line1: number; line2: number; bars: number };
/** Two lines on one scale (e.g. visitors and page views) plus small bars on their own scale (e.g. leads). */
export function Trend({ s, names }: { s: TrendPoint[]; names: [string, string, string] }) {
  const W = 720, H = 220, pad = 28;
  const maxV = Math.max(1, ...s.map((d) => Math.max(d.line1, d.line2)));
  const maxL = Math.max(1, ...s.map((d) => d.bars));
  const x = (i: number) => pad + (s.length > 1 ? (i * (W - pad * 2)) / (s.length - 1) : (W - pad * 2) / 2);
  const y = (v: number) => H - pad - (v / maxV) * (H - pad * 2);
  const line = (k: 'line1' | 'line2') => s.map((d, i) => `${x(i)},${y(d[k])}`).join(' ');
  const bw = Math.max(2, Math.min(18, (W - pad * 2) / Math.max(1, s.length) - 3));
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style="width:100%;height:auto" role="img"
      aria-label={`Daily ${names.join(', ').toLowerCase()} from ${s[0]?.day} to ${s.at(-1)?.day}`}>
      {[0, 0.5, 1].map((f) => <g><line x1={pad} x2={W - pad} y1={y(maxV * f)} y2={y(maxV * f)} stroke="#eee6f0" />
        <text x={pad - 6} y={y(maxV * f) + 4} font-size="11" text-anchor="end" fill="#8a8494">{Math.round(maxV * f)}</text></g>)}
      {s.map((d, i) => d.bars > 0 && <rect x={x(i) - bw / 2} y={H - pad - (d.bars / maxL) * 40} width={bw} height={(d.bars / maxL) * 40} fill={SOFT} rx="2">
        <title>{`${d.day}: ${d.bars} ${names[2].toLowerCase()}`}</title></rect>)}
      <polyline points={line('line2')} fill="none" stroke={PLUM} stroke-width="2" stroke-linejoin="round" />
      <polyline points={line('line1')} fill="none" stroke={ROSE} stroke-width="2.5" stroke-linejoin="round" />
      {s.map((d, i) => <circle cx={x(i)} cy={y(d.line1)} r="6" fill="transparent">
        <title>{`${d.day}: ${d.line1} ${names[0].toLowerCase()}, ${d.line2} ${names[1].toLowerCase()}, ${d.bars} ${names[2].toLowerCase()}`}</title></circle>)}
      <text x={pad} y={H - 8} font-size="11" fill="#8a8494">{fmtDate(s[0]?.day)}</text>
      <text x={W - pad} y={H - 8} font-size="11" fill="#8a8494" text-anchor="end">{fmtDate(s.at(-1)?.day)}</text>
    </svg>
  );
}

export function Legend({ names }: { names: [string, string, string] }) {
  return <div style="display:flex;gap:16px;font-size:13px;flex-wrap:wrap">
    <span><i style={`display:inline-block;width:14px;height:3px;background:${ROSE};vertical-align:middle`} /> {names[0]}</span>
    <span><i style={`display:inline-block;width:14px;height:3px;background:${PLUM};vertical-align:middle`} /> {names[1]}</span>
    <span><i style={`display:inline-block;width:10px;height:10px;background:${SOFT};border-radius:2px`} /> {names[2]}</span></div>;
}
