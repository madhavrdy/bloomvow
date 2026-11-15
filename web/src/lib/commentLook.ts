// Small helpers shared by the blog comments (built page and live refresh) and Admin > Comments.
export function initials(name: string): string {
  const parts = name.replace(/[^\p{L}\p{N}\s&]/gu, ' ').split(/\s+|&/).filter(Boolean);
  const a = parts[0]?.[0] ?? '?';
  const b = parts.length > 1 ? parts[parts.length - 1][0] : '';
  return (a + b).toUpperCase();
}
// A stable soft colour per name (hue in degrees).
export function hue(name: string): number {
  let h = 0;
  for (const ch of name.toLowerCase()) h = (h * 31 + ch.codePointAt(0)!) % 360;
  return [340, 20, 150, 200, 260, 35, 175, 300][h % 8];
}
export function relTime(iso: string, now = Date.now()): string {
  const s = Math.max(0, (now - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = s / 60, h = m / 60, d = h / 24;
  if (m < 60) return `${Math.floor(m)} min ago`;
  if (h < 24) return `${Math.floor(h)} hour${Math.floor(h) === 1 ? '' : 's'} ago`;
  if (d < 7) return `${Math.floor(d)} day${Math.floor(d) === 1 ? '' : 's'} ago`;
  return fullDate(iso);
}
export const fullDate = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
export const hasLink = (s: string) => /(https?:\/\/|www\.|\.[a-z]{2,}\/)/i.test(s);
