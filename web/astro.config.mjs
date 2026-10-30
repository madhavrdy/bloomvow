import { defineConfig } from 'astro/config';
import preact from '@astrojs/preact';

// SITE_URL must be the live domain at build time (used for canonical URLs and the sitemap).
export default defineConfig({
  site: process.env.SITE_URL || 'https://www.example.com',
  trailingSlash: 'always',
  build: { format: 'directory', inlineStylesheets: 'always' },
  compressHTML: true,
  integrations: [preact()],
  prefetch: { prefetchAll: false, defaultStrategy: 'hover' },
});
