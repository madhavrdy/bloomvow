import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// SITE_URL must be the live domain at build time (used for canonical URLs and the sitemap).
export default defineConfig({
  site: process.env.SITE_URL || 'https://www.example.com',
  trailingSlash: 'always',
  // Styles go in a cached file (small ones stay inline): every page used to carry its own ~35 KB copy.
  build: { format: 'directory', inlineStylesheets: 'auto' },
  compressHTML: true,
  integrations: [preact()],
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
});
