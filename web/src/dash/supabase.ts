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
  invalid_message: 'Please write a message (up to 4,000 characters).',
  claim_needs_owner: 'A listing can only be Claimed once someone has claimed it. It has no claim waiting, so it stays Unclaimed.',
  choose_claim: 'Several people asked to claim this listing. Approve the right one under Vendors › Claims.',
  invalid_phone: 'Please enter a valid phone number, like (212) 423-0172. Outside the US and Canada, start with + and the country code.',
};
export function friendly(e: unknown): string {
  const msg = (e as { message?: string })?.message ?? String(e);
  for (const [k, v] of Object.entries(messages)) if (msg.includes(k)) return v;
  if (/Signups not allowed for otp/i.test(msg)) return "There's no account with this email yet. Create one first at /vendor-dashboard/ (New account), confirm your email, then sign in here.";
  if (/Signups not allowed/i.test(msg)) return 'New sign-ups are switched off for this site right now.';
  if (/Email not confirmed/i.test(msg)) return 'Please confirm your email first: click the link we sent you (check spam too).';
  if (/duplicate key.*claims_one_pending/.test(msg)) return 'You already asked to claim this listing. We will review it shortly.';
  if (/ad_campaigns_image_url_check/.test(msg)) return 'The banner image needs to be uploaded again (it must come from a secure https address).';
  if (/ad_campaigns_link_url_check/.test(msg)) return 'Please enter the full link, starting with https://';
  if (/violates check constraint/.test(msg)) return "Some details aren't in a valid format. Please check the highlighted fields and try again.";
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
