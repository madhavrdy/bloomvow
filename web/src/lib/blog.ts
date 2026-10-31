export const BLOG_PAGE_SIZE = 12;
export const pageCount = (n: number) => Math.max(1, Math.ceil(n / BLOG_PAGE_SIZE));
export const pageSlice = <T,>(a: T[], page: number) => a.slice((page - 1) * BLOG_PAGE_SIZE, page * BLOG_PAGE_SIZE);
// getStaticPaths helper for [...page] routes: undefined = page 1, 'page/N' = page N.
export const pageParams = (total: number) =>
  Array.from({ length: pageCount(total) }, (_, i) => (i === 0 ? undefined : `page/${i + 1}`));
