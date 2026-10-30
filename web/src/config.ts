// import.meta.env is provided by Astro/Vite; fall back to process.env in plain Node (tests).
const env: Record<string, string | undefined> = (import.meta as { env?: Record<string, string> }).env ?? (globalThis as { process?: { env: Record<string, string> } }).process?.env ?? {};

export const SITE_NAME = env.PUBLIC_SITE_NAME || 'Bloomvow';
export const SUPABASE_URL = (env.PUBLIC_SUPABASE_URL || '').replace(/\/$/, '');
export const SUPABASE_ANON_KEY = env.PUBLIC_SUPABASE_ANON_KEY || '';
export const CONTACT_EMAIL = env.PUBLIC_CONTACT_EMAIL || 'hello@example.com';
export const TAGLINE = 'Find, compare and book wedding vendors';
