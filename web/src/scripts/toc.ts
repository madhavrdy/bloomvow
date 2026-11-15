// Blog post "In this article" contents, reading progress and the floating Contents button.
// Desktop (wide screens): a sticky sidebar, always open, that highlights the section being read.
// Phones and tablets: a collapsed box above the article, plus a small Contents button once you
// scroll past it.
const WIDE = '(min-width: 1100px)';

export function initToc() {
  const toc = document.querySelector<HTMLDetailsElement>('details.toc');
  const bar = document.querySelector<HTMLElement>('.read-progress span');
  const article = document.querySelector<HTMLElement>('.post .prose');
  if (bar && article) {
    const onScroll = () => {
      const r = article.getBoundingClientRect();
      const total = r.height - innerHeight * 0.6;
      const done = Math.min(1, Math.max(0, -r.top / Math.max(total, 1)));
      bar.style.transform = `scaleX(${done})`;
    };
    addEventListener('scroll', onScroll, { passive: true }); onScroll();
  }
  if (!toc) return;

  const wide = matchMedia(WIDE);
  const fit = () => { toc.open = wide.matches; toc.classList.toggle('is-wide', wide.matches); };
  fit(); wide.addEventListener('change', fit);
  // On the sidebar the summary is just a title; don't let it collapse the list.
  toc.querySelector('summary')!.addEventListener('click', (e) => { if (wide.matches) e.preventDefault(); });
  toc.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('a') && !wide.matches) toc.open = false;
  });

  // Highlight the section being read.
  const links = [...toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')];
  const targets = links.map((a) => document.getElementById(decodeURIComponent(a.hash.slice(1)))).filter((x): x is HTMLElement => !!x);
  let current: HTMLAnchorElement | null = null;
  const pick = () => {
    let i = -1;
    for (let k = 0; k < targets.length; k++) if (targets[k].getBoundingClientRect().top < innerHeight * 0.35) i = k;
    const a = i >= 0 ? links[i] : null;
    if (a === current) return;
    current?.removeAttribute('aria-current');
    current = a;
    if (a) {
      a.setAttribute('aria-current', 'location');
      if (wide.matches) {
        const box = toc.querySelector<HTMLElement>('ol')!;
        const top = a.offsetTop - box.offsetTop;
        if (top < box.scrollTop + 20 || top > box.scrollTop + box.clientHeight - 40) box.scrollTo({ top: top - box.clientHeight / 3, behavior: 'smooth' });
      }
    }
  };
  addEventListener('scroll', pick, { passive: true }); pick();

  // Floating Contents button on smaller screens, once the contents box is out of view.
  const fab = document.querySelector<HTMLButtonElement>('.toc-fab');
  if (fab) {
    const io = new IntersectionObserver(([e]) => {
      const past = !e.isIntersecting && e.boundingClientRect.top < 0;
      const end = document.querySelector('#comments')?.getBoundingClientRect().top ?? Infinity;
      fab.hidden = wide.matches || !past || end < innerHeight;
    });
    io.observe(toc);
    addEventListener('scroll', () => {
      const end = document.querySelector('#comments')?.getBoundingClientRect().top ?? Infinity;
      if (end < innerHeight) fab.hidden = true;
    }, { passive: true });
    fab.addEventListener('click', () => {
      toc.open = true;
      toc.scrollIntoView({ behavior: 'smooth', block: 'start' });
      (current ?? links[0])?.focus({ preventScroll: true });
    });
  }
}
