import { useEffect, useState } from 'preact/hooks';
import type { Session } from '@supabase/supabase-js';
import { sb } from '../supabase';
import { Auth, NewPassword } from '../Auth';
import { useHash, loadRef, type Ref } from '../shared';
import { Overview } from './Overview';
import { Leads } from './Leads';
import { Vendors } from './Vendors';
import { Reviews } from './Reviews';
import { Taxonomy } from './Taxonomy';
import { Posts } from './Posts';
import { BlogCategories } from './BlogCategories';
import { Comments } from './Comments';
import { Team } from './Team';
import { PageContent } from './PageContent';

export type Role = 'admin' | 'editor';
type Counts = { claims: number; reviews: number; comments: number };

// Editors see the content screens (page content and blog).
const NAV: { r: string; label: string; roles: Role[] }[] = [
  { r: 'overview', label: 'Overview', roles: ['admin'] },
  { r: 'leads', label: 'Leads', roles: ['admin'] },
  { r: 'vendors', label: 'Vendors & claims', roles: ['admin'] },
  { r: 'reviews', label: 'Reviews', roles: ['admin'] },
  { r: 'taxonomy', label: 'Cities & categories', roles: ['admin'] },
  { r: 'pages', label: 'Page content', roles: ['admin', 'editor'] },
  { r: 'posts', label: 'Blog posts', roles: ['admin', 'editor'] },
  { r: 'blog-categories', label: 'Blog categories', roles: ['admin', 'editor'] },
  { r: 'comments', label: 'Comments', roles: ['admin'] },
  { r: 'team', label: 'Team', roles: ['admin'] },
];

export function AdminApp({ siteName }: { siteName: string }) {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    sb().auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = sb().auth.onAuthStateChange((ev, s) => { setSession(s); if (ev === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  if (session === undefined) return <div class="auth-wrap"><p class="muted">Loading…</p></div>;
  if (recovery) return <NewPassword onDone={() => setRecovery(false)} />;
  if (!session) return <div class="dash admin"><Auth siteName={siteName} title="Admin sign in" subtitle="For the site team only." allowSignup={false} /></div>;
  return <Gate session={session} siteName={siteName} />;
}

function Gate({ session, siteName }: { session: Session; siteName: string }) {
  const [role, setRole] = useState<string | null | undefined>(undefined);
  const [ref, setRef] = useState<Ref | null>(null);
  const [counts, setCounts] = useState<Counts>({ claims: 0, reviews: 0, comments: 0 });
  const [route] = useHash('');

  useEffect(() => {
    sb().from('profiles').select('role').eq('id', session.user.id).maybeSingle().then(({ data }) => setRole((data as { role: string } | null)?.role ?? null));
    loadRef().then(setRef);
  }, [session.user.id]);

  const refreshCounts = () => {
    if (role !== 'admin') return;
    Promise.all([
      sb().from('claims').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb().from('reviews').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
      sb().from('comments').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]).then(([a, b, c]) => setCounts({ claims: a.count ?? 0, reviews: b.count ?? 0, comments: c.count ?? 0 }));
  };
  useEffect(refreshCounts, [role, route]);

  if (role === undefined || !ref) return <div class="auth-wrap"><p class="muted">Loading…</p></div>;
  if (role !== 'admin' && role !== 'editor') {
    return (
      <div class="auth-wrap"><div class="auth">
        <h1 style="margin:0;font-size:24px">Access denied</h1>
        <p class="muted" style="margin:0">{session.user.email} doesn't have admin access. Vendors manage their listing in the <a href="/vendor-dashboard/">vendor dashboard</a>.</p>
        <button class="btn btn-outline" onClick={() => sb().auth.signOut()}>Sign out</button>
      </div></div>
    );
  }
  const r = role as Role;
  const allowed = NAV.filter((n) => n.roles.includes(r));
  const current = allowed.find((n) => n.r === route)?.r ?? allowed[0].r;
  const badge = (k: string) => ({ vendors: counts.claims, reviews: counts.reviews, comments: counts.comments } as Record<string, number>)[k] ?? 0;

  return (
    <div class="dash admin">
      <nav class="side" aria-label="Admin">
        <a href="/" class="logo" style="font-size:28px">{siteName}</a>
        <span class="tag">{r === 'admin' ? 'Admin' : 'Editor'}</span>
        {allowed.map((n) => (
          <a href={`#${n.r}`} aria-current={current === n.r ? 'page' : undefined}>
            {n.label}{badge(n.r) > 0 && <span class="count">{badge(n.r)}</span>}
          </a>
        ))}
        <span class="spacer" />
        <span style="font-size:12px;padding:0 12px;color:#b7b0c4">{session.user.email}</span>
        <button type="button" class="navbtn" onClick={() => sb().auth.signOut()}>Sign out</button>
      </nav>
      <main class="dmain">
        {current === 'overview' && <Overview ref_={ref} />}
        {current === 'leads' && <Leads ref_={ref} />}
        {current === 'vendors' && <Vendors ref_={ref} onChange={refreshCounts} />}
        {current === 'reviews' && <Reviews onChange={refreshCounts} />}
        {current === 'taxonomy' && <Taxonomy />}
        {current === 'posts' && <Posts ref_={ref} userId={session.user.id} userName={(session.user.user_metadata?.full_name as string) || ''} />}
        {current === 'pages' && <PageContent />}
        {current === 'blog-categories' && <BlogCategories />}
        {current === 'comments' && <Comments onChange={refreshCounts} />}
        {current === 'team' && <Team selfEmail={session.user.email ?? ''} />}
      </main>
    </div>
  );
}
