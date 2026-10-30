export function kmBetween(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = (x: number) => (x * Math.PI) / 180;
  const a = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(a));
}

// Round a price to a "nice" filter boundary: 1,234 -> 1,000; 17,800 -> 18,000.
export function niceRound(n: number): number {
  if (n <= 0) return 0;
  const step = n < 1000 ? 100 : n < 10000 ? 500 : 1000;
  return Math.max(step, Math.round(n / step) * step);
}
