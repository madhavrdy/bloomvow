import { useState } from 'preact/hooks';
import { sb, friendly } from './supabase';

type Mode = 'signin' | 'signup' | 'link' | 'reset';

// Sign in / create account / magic link / password reset. Shared by vendor and admin areas.
export function Auth({ title, subtitle, allowSignup = true, siteName }: { title: string; subtitle: string; allowSignup?: boolean; siteName: string }) {
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: Event) {
    e.preventDefault();
    setError(''); setInfo(''); setBusy(true);
    const redirect = location.origin + location.pathname + location.search;
    try {
      if (mode === 'signin') {
        const { error } = await sb().auth.signInWithPassword({ email, password });
        if (error) throw error;
      } else if (mode === 'signup') {
        if (password.length < 8) throw new Error('Please use a password of at least 8 characters.');
        const { data, error } = await sb().auth.signUp({ email, password, options: { data: { full_name: name }, emailRedirectTo: redirect } });
        if (error) throw error;
        if (!data.session) setInfo('Check your email to confirm your account, then come back here to sign in.');
      } else if (mode === 'link') {
        const { error } = await sb().auth.signInWithOtp({ email, options: { emailRedirectTo: redirect, shouldCreateUser: allowSignup } });
        if (error) throw error;
        setInfo('We sent you a sign-in link. Open it on this device.');
      } else {
        const { error } = await sb().auth.resetPasswordForEmail(email, { redirectTo: redirect });
        if (error) throw error;
        setInfo('If that email has an account, a reset link is on its way.');
      }
    } catch (ex) {
      setError(friendly(ex));
    } finally {
      setBusy(false);
    }
  }

  const label = { signin: 'Sign in', signup: 'Create account', link: 'Email me a sign-in link', reset: 'Send reset link' }[mode];
  return (
    <div class="auth-wrap">
      <form class="auth" onSubmit={submit}>
        <a href="/" class="logo" style="font-size:28px">{siteName}</a>
        <div>
          <h1 style="margin:0 0 4px;font-size:24px">{mode === 'signup' ? 'Create your account' : mode === 'reset' ? 'Reset your password' : title}</h1>
          <p class="muted" style="margin:0;font-size:14px">{subtitle}</p>
        </div>
        {allowSignup && (mode === 'signin' || mode === 'signup') && (
          <div class="seg" role="group" aria-label="Account">
            <button type="button" aria-pressed={mode === 'signin'} onClick={() => setMode('signin')}>Sign in</button>
            <button type="button" aria-pressed={mode === 'signup'} onClick={() => setMode('signup')}>New account</button>
          </div>
        )}
        {mode === 'signup' && <label class="field">Your name<input value={name} onInput={(e) => setName(e.currentTarget.value)} autocomplete="name" /></label>}
        <label class="field">Email<input type="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} autocomplete="email" /></label>
        {(mode === 'signin' || mode === 'signup') && (
          <label class="field">Password<input type="password" required minLength={mode === 'signup' ? 8 : 1} value={password}
            onInput={(e) => setPassword(e.currentTarget.value)} autocomplete={mode === 'signup' ? 'new-password' : 'current-password'} /></label>
        )}
        {error && <p class="form-error" role="alert">{error}</p>}
        {info && <p class="form-ok" role="status" style="margin:0">{info}</p>}
        <button class="btn btn-acc btn-lg" disabled={busy}>{busy ? 'Please wait…' : label}</button>
        <div style="display:flex;flex-wrap:wrap;gap:8px 16px;font-size:14px">
          {mode !== 'link' && <button type="button" class="linkbtn" onClick={() => setMode('link')}>Sign in with an email link</button>}
          {mode !== 'reset' && mode !== 'signup' && <button type="button" class="linkbtn" onClick={() => setMode('reset')}>Forgot password?</button>}
          {(mode === 'link' || mode === 'reset') && <button type="button" class="linkbtn" onClick={() => setMode('signin')}>Back to sign in</button>}
        </div>
      </form>
    </div>
  );
}

// Shown after a password-reset link: set a new password.
export function NewPassword({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  return (
    <div class="auth-wrap">
      <form class="auth" onSubmit={async (e) => {
        e.preventDefault();
        if (pw.length < 8) return setErr('Please use at least 8 characters.');
        const { error } = await sb().auth.updateUser({ password: pw });
        if (error) setErr(friendly(error)); else onDone();
      }}>
        <h1 style="margin:0;font-size:24px">Choose a new password</h1>
        <label class="field">New password<input type="password" value={pw} onInput={(e) => setPw(e.currentTarget.value)} autocomplete="new-password" /></label>
        {err && <p class="form-error">{err}</p>}
        <button class="btn btn-acc btn-lg">Save password</button>
      </form>
    </div>
  );
}
