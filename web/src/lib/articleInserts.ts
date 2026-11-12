// Where things go inside a blog post, between sections. Each insert goes just before a
// section heading (<h2>), so it lands at the end of the section above. Never two at one spot.
// * AdSense: after the intro (or after the first section if the post opens with a heading),
//   and before the heading nearest the middle (posts with 4+ sections).
// * "Read more" boxes: about a third (3+ sections) and two-thirds (6+ sections) of the way in.
// * Vendor box: a little past halfway (4+ sections).
export function placeInArticle(html: string, o: { adIntro: string; adMid: string; readMore: string[]; vendor: string }) {
  const at = [...html.matchAll(/<h2[\s>]/g)].map((m) => m.index!);
  const n = at.length;
  const taken = new Set<number>();
  const cuts: [number, string][] = [];
  const put = (i: number, ins: string) => {
    if (!ins || i < 0) return false;
    let j = i;
    while (j < n && taken.has(j)) j++;
    if (j >= n) return false;
    taken.add(j); cuts.push([at[j], ins]); return true;
  };
  if (n) {
    put(at[0] > 0 ? 0 : 1, o.adIntro);
    if (n >= 4) put(Math.floor(n / 2), o.adMid);
  }
  let readMoreUsed = 0;
  if (n >= 3 && o.readMore[0] && put(Math.max(1, Math.round(n / 3)), o.readMore[0])) readMoreUsed++;
  if (n >= 4) put(Math.max(2, Math.round(n * 0.55)), o.vendor);
  if (n >= 6 && o.readMore[readMoreUsed] && put(Math.round((n * 2) / 3) + 1, o.readMore[readMoreUsed])) readMoreUsed++;
  let out = html;
  for (const [pos, ins] of cuts.sort((x, y) => y[0] - x[0])) out = out.slice(0, pos) + ins + out.slice(pos);
  return { html: out, readMoreUsed };
}
