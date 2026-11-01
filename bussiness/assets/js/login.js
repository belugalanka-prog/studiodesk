import { supabase } from './supabase.js';
if (localStorage.getItem('sd-theme') === 'dark') document.documentElement.classList.add('dark');

const isClient = location.pathname.endsWith('client-login.html');
const role = isClient ? 'client' : 'admin';
const home = isClient ? 'pages/client-dashboard.html' : 'pages/dashboard.html';
const form = document.querySelector('#login-form');
const error = form.querySelector('.form-error');
const button = form.querySelector('button[type=submit]');
const messages = {
  wrongrole: isClient ? 'That account is an admin account. Use the admin sign in.' : 'That account is a client account. Use the client portal sign in.',
  noprofile: 'Your account has no profile row yet. Run supabase/schema.sql first, then create the user again.'
};
const m = new URLSearchParams(location.search).get('msg');
if (m && messages[m]) error.textContent = messages[m];

async function roleOf(user) {
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return data?.role;
}

const { data: { session } } = await supabase.auth.getSession();
if (session && !m && (await roleOf(session.user)) === role) location.replace(home);

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  button.disabled = true; button.textContent = 'Signing in…';
  try {
    const data = Object.fromEntries(new FormData(form));
    const { data: res, error: authError } = await supabase.auth.signInWithPassword({ email: data.email.trim(), password: data.password });
    if (authError) throw authError;
    const r = await roleOf(res.user);
    if (!r) { await supabase.auth.signOut(); throw new Error(messages.noprofile); }
    if (r !== role) { await supabase.auth.signOut(); throw new Error(messages.wrongrole); }
    location.href = home;
  } catch (e) {
    error.textContent = e.message;
    button.disabled = false; button.textContent = 'Sign in';
  }
});
