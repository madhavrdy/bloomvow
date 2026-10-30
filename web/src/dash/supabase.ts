import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

// One client per page. URL and anon key come from the <meta name="bv-api"> tag
// written at build time, so the same build works locally and in production.
export function sb(): SupabaseClient {
  if (client) return client;
  const m = document.querySelector<HTMLMetaElement>('meta[name="bv-api"]');
  client = createClient(m?.content ?? '', m?.dataset.key ?? '', {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'bv-auth' },
  });
  return client;
}

// Turn database/API error codes into plain sentences.
const messages: Record<string, string> = {
  already_claimed: 'This listing is already managed by its owner. Contact us if that is you.',
  city_limit_reached: 'Your plan has reached its limit of city pages. Upgrade to Featured to appear in more cities.',
  photo_limit_reached: 'You can add up to 30 photos per listing.',
  too_many_pending: 'You already have 3 businesses waiting for approval. We will review them shortly.',
  name_required: 'Please enter your business name.',
  invalid_city: 'Please choose a city from the list.',
  invalid_category: 'Please choose a category.',
  forbidden: "You don't have access to that.",
  'Invalid login credentials': 'That email and password don\'t match. Try again or reset your password.',
  'User already registered': 'An account with this email already exists. Sign in instead.',
  invalid_status: 'That status is not available.',
};
export function friendly(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  for (const [k, v] of Object.entries(messages)) if (msg.includes(k)) return v;
  if (/duplicate key.*claims_one_pending/.test(msg)) return 'You already asked to claim this listing. We will review it shortly.';
  if (/row-level security|violates/.test(msg)) return "You don't have permission to change that.";
  if (/mime type|invalid_mime/.test(msg)) return 'Please upload a JPG, PNG or WebP image.';
  if (/maximum allowed size|too large/i.test(msg)) return 'That image is larger than 5 MB. Please use a smaller one.';
  return msg.length < 140 ? msg : 'Something went wrong. Please try again.';
}

// Throw on Supabase errors so callers can use try/catch.
export async function must<T>(p: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await p;
  if (error) throw error;
  return data;
}
