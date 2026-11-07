// Celebrateio logo: the mandap arch (ogee point, like a mandap or jharokha doorway) with a
// marigold sparkle, plus the wordmark "celebrate" (light) + "io" (bold) in Outfit.
// From the "Celebrateio Logo" design (Mandap Arch direction). Used by the site header and
// footer (Astro) and the dashboards and sign-in screens (Preact) via plain HTML strings.

export const BRAND = { plum: '#3A1D4A', marigold: '#F4A42C', sindoor: '#E8692F', rose: '#F29BC1' };

const ARCH = 'M20 94 V52 C20 32 33 21 44 13 C47 11 49 8 50 4 C51 8 53 11 56 13 C67 21 80 32 80 52 V94';
const SPARK = 'M50 46 L53.6 58.4 L66 62 L53.6 65.6 L50 78 L46.4 65.6 L34 62 L46.4 58.4 Z';

/** The arch mark as inline SVG. `color` = arch stroke, `spark` = sparkle fill. */
export function archSvg(color: string = BRAND.plum, spark: string = BRAND.marigold, size = 34): string {
  return `<svg class="logo-mark" viewBox="0 0 100 100" width="${size}" height="${size}" aria-hidden="true" focusable="false">`
    + `<path d="${ARCH}" fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>`
    + `<path d="${SPARK}" fill="${spark}"/></svg>`;
}

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

/** The wordmark. "Celebrateio" is drawn as celebrate + bold io, in lower case like the logo;
 *  any other site name is shown as given. */
export function wordmarkHtml(siteName: string): string {
  const m = /^(celebrate)(io)$/i.exec(siteName.trim());
  return m ? `<span class="logo-word">celebrate<b>io</b></span>` : `<span class="logo-word">${esc(siteName)}</span>`;
}

/** Full lockup: arch + wordmark. `tone` "dark" = plum on light backgrounds, "light" = white on dark. */
export function logoHtml(siteName: string, tone: 'dark' | 'light' = 'dark', size = 34): string {
  const ink = tone === 'light' ? '#FFFFFF' : BRAND.plum;
  return `${archSvg(ink, BRAND.marigold, size)}${wordmarkHtml(siteName)}`;
}
