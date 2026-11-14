// "My <brand>": the customer's inbox for their requests and vendor replies.
// No password: the personal link in every email (?t=...) signs this browser in.
import { useEffect, useMemo, useState } from 'preact/hooks';
import { logoHtml } from '../../lib/brand';
import { sb, friendly } from '../supabase';
import { ago, fmtDate, Toast, useToast } from '../shared';

type Msg = { from: 'vendor' | 'customer'; body: string; at: string };
type Thread = { vendor_id: string; name: string; slug: string; claimed: boolean; category: string; photo: string | null;
  sent_at: string; seen: boolean; replied: boolean; unread: number; last_at: string; messages: Msg[] };
type Request = { lead_id: string; created_at: string; source: string; message: string | null; wedding_date: string | null;
  date_flexible: boolean; guests: number | null; city: string; categories: string[]; vendors: Thread[] };
type Inbox = { email: string; name: string | null; requests: Request[] };

const KEY = 'bv_ct';
const store = { get: () => { try { return localStorage.getItem(KEY); } catch { return null; } },
  set: (t: string | null) => { try { if (t) localStorage.setItem(KEY, t); else localStorage.removeItem(KEY); } catch { /* blocked */ } } };

function takeToken(): string | null {
  const u = new URL(location.href);
  const t = u.searchParams.get('t');
  if (t) {
    store.set(t);
    u.searchParams.delete('t');
    history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash);   // keep the link out of history and referrers
  }
  return t ?? store.get();
}

export function CustomerApp({ siteName }: { siteName: string }) {
  const [token, setToken] = useState<string | null>(() => takeToken());
  const [inbox, setInbox] = useState<Inbox | null>(null);
  const [expired, setExpired] = useState(false);
  const [err, setErr] = useState('');

  async function load(t = token) {
    if (!t) return;
    const { data, error } = await sb().rpc('customer_inbox', { p_token: t });
    if (error) {
      if (/invalid_link/.test(error.message)) { store.set(null); setToken(null); setExpired(true); return; }
      setErr(friendly(error)); return;
    }
    setInbox(data as Inbox);
  }
  useEffect(() => { load(); }, [token]);
  // Pick up new replies while the page is open.
  useEffect(() => {
    if (!token) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') load(); }, 60_000);
    return () => clearInterval(id);
  }, [token]);

  const title = `My ${siteName}`;
  if (!token) return <SignIn title={title} siteName={siteName} expired={expired} />;
  if (err) return <div class="auth-wrap"><div class="auth"><p class="form-error">{err}</p><button class="btn btn-acc" onClick={() => { setErr(''); load(); }}>Try again</button></div></div>;
  if (!inbox) return <div class="auth-wrap"><p class="muted">Loading your inbox…</p></div>;
  return <InboxView title={title} siteName={siteName} inbox={inbox} token={token} reload={load}
    signOut={() => { store.set(null); setToken(null); setInbox(null); }} />;
}

function SignIn({ title, siteName, expired }: { title: string; siteName: string; expired: boolean }) {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  async function submit(e: Event) {
    e.preventDefault(); setErr('');
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email.trim())) { setErr('Please enter a valid email address.'); return; }
    setBusy(true);
    const { error } = await sb().rpc('customer_request_link', { p_email: email.trim() });
    setBusy(false);
    if (error) setErr(friendly(error)); else setSent(true);
  }
  return (
    <div class="auth-wrap">
      <form class="auth" onSubmit={submit} noValidate>
        <a href="/" style="text-decoration:none" aria-label={`${siteName} home`} dangerouslySetInnerHTML={{ __html: logoHtml(siteName, 'dark', 30) }} />
        <h1 style="margin:0;font-size:24px">{title}</h1>
        {expired && <p class="form-error" role="alert" style="margin:0">That link has expired or was replaced. Get a new one below.</p>}
        {sent ? (
          <p role="status" style="margin:0">If <b>{email.trim()}</b> has sent a request on {siteName}, a link to your inbox is on its way. Check your email (and spam folder).</p>
        ) : <>
          <p style="margin:0" class="muted">See your requests and vendor replies in one place. Enter the email you used when you asked for quotes and we'll send you a sign-in link. No password needed.</p>
          <label class="field">Email<input type="email" autocomplete="email" value={email} onInput={(e) => setEmail(e.currentTarget.value)} required /></label>
          {err && <p class="form-error" role="alert" style="margin:0">{err}</p>}
          <button class="btn btn-acc btn-lg" disabled={busy}>{busy ? 'Sending…' : 'Email me a link'}</button>
          <p class="muted" style="margin:0;font-size:13px">Haven't asked for quotes yet? <a href="/get-matched/">Get matched with vendors</a>.</p>
        </>}
      </form>
    </div>
  );
}

function InboxView({ title, siteName, inbox, token, reload, signOut }: {
  title: string; siteName: string; inbox: Inbox; token: string; reload: () => Promise<void>; signOut: () => void;
}) {
  const all = useMemo(() => inbox.requests.flatMap((r) => r.vendors.map((v) => ({ r, v }))), [inbox]);
  const firstUnread = all.find((x) => x.v.unread > 0) ?? all.find((x) => x.v.replied) ?? all[0];
  const [sel, setSel] = useState<string | null>(firstUnread ? `${firstUnread.r.lead_id}:${firstUnread.v.vendor_id}` : null);
  const [mobileThread, setMobileThread] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [toast, setToast] = useToast();
  const cur = all.find((x) => `${x.r.lead_id}:${x.v.vendor_id}` === sel) ?? null;
  const unreadTotal = all.reduce((a, x) => a + x.v.unread, 0);

  useEffect(() => {
    if (cur && cur.v.unread > 0) sb().rpc('customer_mark_read', { p_token: token, p_lead: cur.r.lead_id, p_vendor: cur.v.vendor_id }).then(() => reload());
  }, [sel]);

  async function send() {
    if (!cur || !text.trim()) return;
    setBusy(true); setErr('');
    const { error } = await sb().rpc('customer_send', { p_token: token, p_lead: cur.r.lead_id, p_vendor: cur.v.vendor_id, p_body: text.trim() });
    setBusy(false);
    if (error) { setErr(friendly(error)); return; }
    setText(''); setToast(`Message sent to ${cur.v.name}`); await reload();
  }
  const open = (k: string) => { setSel(k); setText(''); setErr(''); setMobileThread(true); };
  const status = (v: Thread) => v.unread > 0 ? `${v.unread} new` : v.replied ? 'Replied' : v.seen ? 'Seen, not replied yet' : 'Sent';

  return (
    <div class="cust">
      <header class="cust-top">
        <a href="/" style="text-decoration:none" aria-label={`${siteName} home`} dangerouslySetInnerHTML={{ __html: logoHtml(siteName, 'dark', 28) }} />
        <b class="cust-title">{title}</b>
        <span class="spacer" />
        <span class="muted cust-email">{inbox.email}</span>
        <button type="button" class="btn btn-outline btn-sm" onClick={signOut}>Sign out</button>
      </header>
      <main class="cust-main">
        <div class="dhead"><h1 style="margin:0">{inbox.name ? `Hi ${inbox.name.split(/\s|&/)[0]}` : 'Your inbox'}</h1>
          <a class="btn btn-outline btn-sm" href="/get-matched/">+ New request</a></div>
        {inbox.requests.length === 0 ? (
          <div class="panel"><p class="empty">No requests in the last 12 months. <a href="/get-matched/">Ask vendors for quotes</a> and their replies will appear here.</p></div>
        ) : (
          <div class={`inbox ${mobileThread ? 'show-thread' : ''}`}>
            <section class="inbox-list" aria-label={`Conversations${unreadTotal ? `, ${unreadTotal} unread` : ''}`}>
              {inbox.requests.map((r) => <>
                <div class="cust-req"><b>{r.categories.join(', ') || 'Request'}</b>
                  <span>{r.city}{r.wedding_date ? ` · ${fmtDate(r.wedding_date)}` : ''} · sent {ago(r.created_at)}</span></div>
                {r.vendors.length === 0 && <p class="muted" style="padding:10px 16px;margin:0;font-size:14px">We're still finding vendors for this request.</p>}
                {r.vendors.map((v) => { const k = `${r.lead_id}:${v.vendor_id}`; return (
                  <button type="button" aria-current={k === sel ? 'true' : undefined} class={v.unread ? 'unread' : ''} onClick={() => open(k)}>
                    <span style="display:flex;justify-content:space-between;gap:8px;width:100%"><b style="font-size:15px">{v.name}</b>
                      <span class="muted" style="font-size:12px;white-space:nowrap">{ago(v.last_at)}</span></span>
                    <span class="muted" style="font-size:13px">{v.category}</span>
                    <span class={`chip-s ${v.unread ? 's-new' : v.replied ? 's-replied' : 's-pending'}`} style="align-self:flex-start">{status(v)}</span>
                  </button>); })}
              </>)}
            </section>
            {cur ? (
              <section class="panel cust-thread" aria-label={`Conversation with ${cur.v.name}`}>
                <button type="button" class="btn btn-outline btn-sm cust-back" onClick={() => setMobileThread(false)}>← All conversations</button>
                <div class="dhead" style="align-items:flex-start">
                  <div style="display:flex;gap:12px;align-items:center">
                    {cur.v.photo && <img src={cur.v.photo} alt="" width={52} height={52} style="border-radius:12px;object-fit:cover" />}
                    <div><b style="font-size:20px;display:block">{cur.v.name}</b><span class="muted" style="font-size:14px">{cur.v.category}</span></div>
                  </div>
                  <a class="btn btn-outline btn-sm" href={`/vendor/${cur.v.slug}/`} target="_blank" rel="noopener">View profile ↗</a>
                </div>
                <div class="thread">
                  <div class="bubble me"><span class="who">Your request · {ago(cur.r.created_at)}</span>
                    {[cur.r.wedding_date ? `Date: ${fmtDate(cur.r.wedding_date)}${cur.r.date_flexible ? ' (flexible)' : ''}` : 'Date: flexible',
                      cur.r.guests ? `Guests: ${cur.r.guests}` : '', `City: ${cur.r.city}`].filter(Boolean).join(' · ')}
                    {cur.r.message && <>{'\n\n'}{cur.r.message}</>}</div>
                  {cur.v.messages.map((m) => (
                    <div class={`bubble ${m.from === 'customer' ? 'me' : 'them'}`}>
                      <span class="who">{m.from === 'customer' ? 'You' : cur.v.name} · {ago(m.at)}</span>{m.body}</div>
                  ))}
                  {cur.v.messages.length === 0 && <p class="muted" style="margin:0;font-size:14px">
                    {cur.v.claimed ? `${cur.v.name} ${cur.v.seen ? 'has seen your request but hasn\'t replied yet' : 'hasn\'t opened your request yet'}. Most vendors reply within a day; we'll email you when they do.`
                      : `We've let ${cur.v.name} know about your request. We'll email you as soon as they reply.`}</p>}
                </div>
                {cur.v.messages.length > 0 && <>
                  <label class="field">Reply to {cur.v.name}
                    <textarea rows={4} value={text} onInput={(e) => setText(e.currentTarget.value)} maxLength={4000}
                      placeholder="Ask about availability, pricing or a visit…" /></label>
                  {err && <p class="form-error" role="alert" style="margin:0">{err}</p>}
                  <button type="button" class="btn btn-acc btn-lg" style="align-self:flex-end" disabled={busy || !text.trim()} onClick={send}>{busy ? 'Sending…' : 'Send'}</button>
                  <p class="muted" style="margin:0;font-size:12px">We'll let {cur.v.name} know by email. Please don't share card or bank details in messages.</p>
                </>}
              </section>
            ) : null}
          </div>
        )}
      </main>
      <Toast text={toast} />
    </div>
  );
}
