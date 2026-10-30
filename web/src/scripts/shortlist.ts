import { track } from './api';

// Shortlist lives in this browser only (no account needed).
const KEY = 'bv-shortlist';
export type Saved = { id: string; name: string; url: string };

export function readShortlist(): Saved[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]'); } catch { return []; }
}
function write(list: Saved[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage blocked: shortlist just won't persist */ }
}

export function initShortlist() {
  const saved = new Set(readShortlist().map((s) => s.id));
  document.querySelectorAll<HTMLButtonElement>('[data-shortlist]').forEach((btn) => {
    const id = btn.dataset.shortlist!;
    btn.setAttribute('aria-pressed', String(saved.has(id)));
    btn.addEventListener('click', () => {
      const list = readShortlist();
      const i = list.findIndex((s) => s.id === id);
      if (i >= 0) list.splice(i, 1);
      else { list.push({ id, name: btn.dataset.name ?? '', url: btn.dataset.url ?? '' }); track(id, 'shortlist'); }
      write(list);
      btn.setAttribute('aria-pressed', String(i < 0));
    });
  });
}
