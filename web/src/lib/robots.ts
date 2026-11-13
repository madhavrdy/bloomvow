// robots.txt: the built-in default, and checks for a custom version from Admin > SEO files.
// The same rules run in the database (robots_ok, migration 027).

// Search engines and AI assistants are welcome to read and cite public pages.
const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'ClaudeBot', 'Claude-SearchBot', 'Claude-User', 'PerplexityBot',
  'Perplexity-User', 'Google-Extended', 'Applebot-Extended', 'Bingbot', 'CCBot'];
// The back end (/back-end/) is left out on purpose: it is noindex, and listing it here would advertise its address.
const PRIVATE = ['/vendor-dashboard/', '/shortlist/'];

export const ROBOTS_MAX = 10000;

export function defaultRobots(site: string): string {
  const block = (ua: string) => `User-agent: ${ua}\nAllow: /\n${PRIVATE.map((p) => `Disallow: ${p}`).join('\n')}\n`;
  return [block('*'), ...AI_BOTS.map(block), `Sitemap: ${new URL('/sitemap.xml', site).href}\n`].join('\n');
}

const LINE = /^(user-agent|allow|disallow|sitemap|crawl-delay|host|clean-param)\s*:\s*[^\s<>"]*(\s+[^\s<>"]+)?$/i;

/** Lines that are not robots.txt directives (blank lines and # comments are fine). */
export function robotsErrors(text: string): string[] {
  const out: string[] = [];
  if (text.length > ROBOTS_MAX) out.push(`robots.txt is too long (${text.length.toLocaleString()} of ${ROBOTS_MAX.toLocaleString()} characters).`);
  text.split('\n').forEach((raw, i) => {
    const l = raw.trim();
    if (!l || l.startsWith('#')) return;
    if (!LINE.test(l)) out.push(`Line ${i + 1}: "${l.slice(0, 60)}" is not a robots.txt rule (User-agent, Allow, Disallow, Sitemap, Crawl-delay).`);
    else if (/^sitemap\s*:/i.test(l) && !/^sitemap\s*:\s*https?:\/\/\S+$/i.test(l)) out.push(`Line ${i + 1}: Sitemap needs a full address starting with https://`);
  });
  return out;
}

/** Things that are allowed but probably not intended. */
export function robotsWarnings(text: string): string[] {
  const out: string[] = [];
  let agents: string[] = [];
  let inRules = false;
  for (const raw of text.split('\n')) {
    const l = raw.replace(/#.*/, '').trim();
    const m = l.match(/^([a-z-]+)\s*:\s*(.*)$/i);
    if (!m) continue;
    const [k, v] = [m[1].toLowerCase(), m[2].trim()];
    if (k === 'user-agent') { if (inRules) { agents = []; inRules = false; } agents.push(v); continue; }
    inRules = true;
    if (k === 'disallow' && v === '/') {
      const who = agents.includes('*') ? 'all search engines' : agents.join(', ');
      out.push(`"Disallow: /" blocks ${who} from the whole site${agents.includes('*') ? ', so it would drop out of Google' : ''}.`);
    }
  }
  if (!/^\s*sitemap\s*:/im.test(text)) out.push('No Sitemap line: the site adds one automatically.');
  return out;
}

/** The robots.txt that is published: the custom text (with a Sitemap line added if missing) or the default. */
export function finalRobots(custom: string | null | undefined, site: string): string {
  const t = (custom ?? '').replace(/\r/g, '').trim();
  if (!t || robotsErrors(t).length) return defaultRobots(site);
  return /^\s*sitemap\s*:/im.test(t) ? `${t}\n` : `${t}\n\nSitemap: ${new URL('/sitemap.xml', site).href}\n`;
}
