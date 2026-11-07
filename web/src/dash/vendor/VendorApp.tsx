import { logoHtml } from '../../lib/brand';
import { useEffect, useState } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import { sb, must } from '../supabase';
import { Auth, NewPassword } from '../Auth';
import { useHash, loadRef, type Ref } from '../shared';
import { Onboarding } from './Onboarding';
import { Overview } from './Overview';
import { Leads } from './Leads';
import { ListingEditor } from './ListingEditor';

export type Listing = {
  id: string; slug: string; name: string; category_id: number; city_id: number; address: string | null; zip: string | null;
  phone: string | null; website: string | null; email: string | null; description: string | null; price_from: number | null;
  capacity_max: number | null; setting: string | null; amenities: string[]; status: string; plan: string; plan_renews_at: string | null;
  rating: number | null; review_count: number; avg_reply_minutes: number | null;
  details: Record<string, string[] | string | number>;
};
export type Claim = { claim_id: string; claim_status: string; vendor_id: string; name: string; vendor_status: string; created_at: string };

export function VendorApp({ siteName }: { siteName: string }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    sb().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb().auth.onAuthStateChange((ev, s) => { setSession(s); if (ev === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => data.subscription.unsubscribe();
  }, []);

  if (session === undefined) return <div class="auth-wrap"><p class="muted">Loading…</p></div>;
  if (recovery) return <NewPassword onDone={() => setRecovery(false)} />;
  if (!session) return <Auth siteName={siteName} title="Vendor sign in" subtitle="Manage your listing, reply to couples and see your stats." />;
  return <Signed session={session} siteName={siteName} />;
}

function Signed({ session, siteName }: { session: Session; siteName: string }) {
  const [listings, setListings] = useState<Listing[] | null>(null);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [ref, setRef] = useState<Ref | null>(null);
  const [active, setActive] = useState<string>(() => { try { return localStorage.getItem('bv-active-listing') ?? ''; } catch { return ''; } });
  const [route] = useHash('overview');
  const [newLeads, setNewLeads] = useState(0);
  const [adding, setAdding] = useState(false);

  async function reload() {
    const [ls, cs] = await Promise.all([
      must<Listing[]>(sb().from('vendors').select('*').eq('owner_id', session.user.id).order('name') as never),
      must<Claim[]>(sb().from('my_claims').select('*').order('created_at', { ascending: false }) as never),
    ]);
    setListings(ls);
    setClaims(cs);
  }
  useEffect(() => { reload(); loadRef().then(setRef); }, [session.user.id]);

  const current = listings?.find((l) => l.id === active) ?? listings?.[0];
  useEffect(() => {
    if (!current) return;
    try { localStorage.setItem('bv-active-listing', current.id); } catch { /* ignore */ }
    sb().from('lead_recipients').select('lead_id', { count: 'exact', head: true }).eq('vendor_id', current.id).eq('status', 'new')
      .then(({ count }) => setNewLeads(count ?? 0));
  }, [current?.id, route]);

  if (!listings || !ref) return <div class="auth-wrap"><p class="muted">Loading your account…</p></div>;
  const pending = claims.filter((c) => c.claim_status === 'pending');
  if (!current || adding) {
    return <Onboarding siteName={siteName} ref_={ref} pending={pending} email={session.user.email ?? ''} hasListing={Boolean(current)}
      onDone={reload} onCancel={current ? () => setAdding(false) : undefined} />;
  }

  const cat = ref.catById.get(current.category_id)!;
  const city = ref.cityById.get(current.city_id)!;
  const publicUrl = `/vendor/${current.slug}/`;
  const nav = [['overview', 'Overview'], ['leads', 'Leads'], ['listing', 'Edit listing']] as const;
  return (
    <div class="dash">
      <nav class="side" aria-label="Vendor">
        <a href="/" class="logo" aria-label={`${siteName} home`} dangerouslySetInnerHTML={{ __html: logoHtml(siteName, 'dark', 30) }} />
        <span class="tag">For vendors</span>
        <div class="who">
          <span class="mono" aria-hidden="true">{current.name.split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase()}</span>
          <div style="display:flex;flex-direction:column;min-width:0">
            {listings.length > 1 ? (
              <label><span class="sr-only">Listing</span>
                <select value={current.id} onChange={(e) => setActive(e.currentTarget.value)}>{listings.map((l) => <option value={l.id}>{l.name}</option>)}</select>
              </label>
            ) : <b style="font-size:14px">{current.name}</b>}
            <span style="font-size:12px;color:var(--acc);font-weight:600">{current.plan === 'featured' ? 'Featured plan' : 'Free plan'}</span>
          </div>
        </div>
        {nav.map(([r, label]) => (
          <a href={`#${r}`} aria-current={route === r ? 'page' : undefined}>
            {label}{r === 'leads' && newLeads > 0 && <span class="count">{newLeads} new</span>}
          </a>
        ))}
        <a href={publicUrl} target="_blank" rel="noopener" style="color:var(--acc);font-weight:600">View my public page ↗</a>
        <span class="spacer" />
        <button type="button" class="navbtn" onClick={() => setAdding(true)}>+ Add another business</button>
        {pending.length > 0 && <span class="muted" style="font-size:13px;padding:0 12px">{pending.length} claim{pending.length > 1 ? 's' : ''} awaiting approval</span>}
        <button type="button" class="navbtn" onClick={() => sb().auth.signOut()}>Sign out</button>
      </nav>
      <main class="dmain">
        {route === 'leads' ? <Leads listing={current} ref_={ref} onChange={() => setNewLeads((n) => n)} />
          : route === 'listing' ? <ListingEditor listing={current} category={cat} city={city} ref_={ref} onSaved={reload} />
          : <Overview listing={current} category={cat} city={city} userName={(session.user.user_metadata?.full_name as string) || ''} />}
      </main>
    </div>
  );
}
