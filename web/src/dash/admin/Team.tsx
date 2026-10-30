import { useState } from 'preact/hooks';
import { sb, friendly } from '../supabase';
import { Toast, useToast } from '../shared';

// Give someone editor (blog only) or admin access. They must have signed up first.
export function Team({ selfEmail }: { selfEmail: string }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [toast, setToast] = useToast();
  async function save(e: Event) {
    e.preventDefault();
    const { error } = await sb().rpc('admin_set_role', { p_email: email, p_role: role });
    if (error) return setToast(/not_found/.test(error.message) ? 'No account with that email. Ask them to sign up at /vendor-dashboard/ first.' : /cannot_demote_self/.test(error.message) ? "You can't remove your own admin access." : friendly(error));
    setToast(`${email} is now ${role === 'vendor' ? 'a regular user' : `an ${role}`}`); setEmail('');
  }
  return (
    <>
      <div class="dhead"><h1>Team</h1></div>
      <form class="panel" onSubmit={save} style="max-width:560px">
        <h2>Give access</h2>
        <p class="muted" style="margin:0;font-size:14px"><b>Editor</b>: blog posts and blog categories only. <b>Admin</b>: everything. Signed in as {selfEmail}.</p>
        <label class="field">Email of an existing account<input type="email" required value={email} onInput={(e) => setEmail(e.currentTarget.value)} /></label>
        <label class="field">Access<select value={role} onChange={(e) => setRole(e.currentTarget.value)}>
          <option value="editor">Editor (blog only)</option><option value="admin">Admin (everything)</option><option value="vendor">Remove access</option></select></label>
        <button class="btn btn-primary">Save access</button>
      </form>
      <Toast text={toast} />
    </>
  );
}
