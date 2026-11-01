import { supabase } from './supabase.js';
if (localStorage.getItem('sd-theme') === 'dark') document.documentElement.classList.add('dark');

const isClient = location.pathname.endsWith('client-login.html');
const role = isClient ? 'client' : 'admin';
const home = isClient ? 'pages/client-dashboard.html' : 'pages/dashboard.html';
const form = document.querySelector('#login-form');
const error = form.querySelector('.form-error');
const button = form.querySelector('button[type=submit]');

// Only these fixed strings can ever be shown from the ?msg= parameter (no reflected text).
const messages = {
  wrongrole: isClient ? 'That account is an admin account. Use the admin sign in.' : 'That account is a client account. Use the client portal sign in.',
  noprofile: 'Your account is not set up yet. Please contact your studio.',
  idle: 'You were signed out after a period of inactivity.'
};
const m = new URLSearchParams(location.search).get('msg');
if (Object.hasOwn(messages, m)) error.textContent = messages[m];

/* ---------- brute-force slow-down (browser side) ----------
   This protects the form and honest users. The real server-side limits are Supabase Auth's
   rate limits + CAPTCHA (see SECURITY.md); an attacker can bypass anything that lives in the browser. */
const LOCK_KEY = `sd-login-guard-${role}`;
const readGuard = () => { try { return JSON.parse(localStorage.getItem(LOCK_KEY)) || { fails: 0, until: 0 }; } catch (_) { return { fails: 0, until: 0 }; } };
const writeGuard = g => { try { localStorage.setItem(LOCK_KEY, JSON.stringify(g)); } catch (_) { /* private mode */ } };
let timer;
function showLock() {
  clearInterval(timer);
  const tick = () => {
    const left = Math.ceil((readGuard().until - Date.now()) / 1000);
    if (left > 0) { button.disabled = true; button.textContent = `Try again in ${left}s`; }
    else { clearInterval(timer); button.disabled = false; button.textContent = 'Sign in'; if (/^Too many/.test(error.textContent)) error.textContent = ''; }
  };
  tick(); if (readGuard().until > Date.now()) timer = setInterval(tick, 1000);
}
function registerFailure() {
  const g = readGuard(); g.fails += 1;
  if (g.fails >= 5) g.until = Date.now() + Math.min(15 * 60, 30 * 2 ** (g.fails - 5)) * 1000;   // 30s, 1m, 2m, … max 15m
  writeGuard(g); showLock();
}
showLock();

/* ---------- optional Cloudflare Turnstile (enable CAPTCHA in Supabase Auth, then set TURNSTILE_SITE_KEY in config.js) ---------- */
let captchaToken = null, widgetId = null;
const cfg = await import('./config.js');
if (cfg.TURNSTILE_SITE_KEY) {
  await new Promise((resolve, reject) => { const s = document.createElement('script'); s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'; s.onload = resolve; s.onerror = reject; document.head.append(s); }).catch(() => { error.textContent = 'Could not load the security check. Reload the page.'; });
  const box = document.createElement('div'); form.insertBefore(box, button);
  if (window.turnstile) widgetId = window.turnstile.render(box, { sitekey: cfg.TURNSTILE_SITE_KEY, callback: t => { captchaToken = t; }, 'expired-callback': () => { captchaToken = null; } });
}

async function roleOf(user) {
  const { data } = await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle();
  return data?.role;
}

const { data: { session } } = await supabase.auth.getSession();
if (session && !m && (await roleOf(session.user)) === role) location.replace(home);

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = '';
  if (readGuard().until > Date.now()) { showLock(); return; }
  const data = Object.fromEntries(new FormData(form));
  if (data.website) return;                                    // honeypot: bots fill the hidden field
  const email = String(data.email || '').trim().toLowerCase(), password = String(data.password || '');
  if (!email || !password || email.length > 254 || password.length > 128) { error.textContent = 'Enter your email and password.'; return; }
  if (cfg.TURNSTILE_SITE_KEY && !captchaToken) { error.textContent = 'Please complete the security check.'; return; }
  button.disabled = true; button.textContent = 'Signing in…';
  try {
    const { data: res, error: authError } = await supabase.auth.signInWithPassword({ email, password, options: captchaToken ? { captchaToken } : undefined });
    if (authError) {
      registerFailure();
      // One generic message for every credential problem, so the form can't be used to discover which emails exist.
      throw new Error(authError.status === 429 ? 'Too many attempts. Please wait a few minutes.' : 'Incorrect email or password.');
    }
    const r = await roleOf(res.user);
    if (!r) { await supabase.auth.signOut(); throw new Error(messages.noprofile); }
    if (r !== role) { await supabase.auth.signOut(); throw new Error(messages.wrongrole); }
    writeGuard({ fails: 0, until: 0 });
    location.href = home;
  } catch (e) {
    error.textContent = e.message;
    form.elements.password.value = '';
    if (widgetId !== null && window.turnstile) { window.turnstile.reset(widgetId); captchaToken = null; }
    if (readGuard().until > Date.now()) showLock(); else { button.disabled = false; button.textContent = 'Sign in'; }
  }
});
