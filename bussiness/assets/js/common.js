import { supabase } from './supabase.js';

let currency = 'LKR';
export function setCurrency(c) { if (c && /^[A-Z]{3}$/.test(c)) currency = c; }
export const money = n => {
  try { return new Intl.NumberFormat('en-LK', { style: 'currency', currency, maximumFractionDigits: 0 }).format(Number(n || 0)); }
  catch (_) { return `${currency} ${Number(n || 0).toLocaleString()}`; }
};

export const date = d => {
  if (!d) return '—';
  const x = typeof d === 'string' && d.length === 10 ? new Date(`${d}T00:00:00`) : new Date(d);
  return isNaN(x) ? '—' : x.toLocaleDateString('en-LK', { day: 'numeric', month: 'short', year: 'numeric' });
};

let toastTimer;
export function toast(message) {
  let el = document.querySelector('.toast');
  if (!el) { el = document.createElement('div'); el.className = 'toast hidden'; document.body.append(el); }
  el.textContent = message;
  el.classList.remove('hidden');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.add('hidden'), 3500);
}

export function escapeHTML(v = '') {
  if (v === null || v === undefined) return '';
  return String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Admins who have set up an authenticator must pass the MFA challenge on every sign-in.
// When Settings → "Require MFA" is on, an admin without one is sent to set it up first.
async function mfaStep() {
  try {
    const { data: a } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (!a || a.currentLevel === 'aal2') return null;
    if (a.nextLevel === 'aal2') return 'challenge';
    const { data: s } = await supabase.from('business_settings').select('enforce_admin_mfa').eq('id', true).maybeSingle();
    return s?.enforce_admin_mfa ? 'enroll' : null;
  } catch (_) { return null; }
}

export async function requireUser(role) {
  const login = role === 'client' ? '../client-login.html' : '../login.html';
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { location.replace(login); return null; }
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile) { await supabase.auth.signOut(); location.replace(`${login}?msg=noprofile`); return null; }
  if (profile.role !== role) { await supabase.auth.signOut(); location.replace(`${login}?msg=wrongrole`); return null; }
  if (role === 'admin' && await mfaStep()) { location.replace('../mfa.html'); return null; }
  return { user, profile };
}

// A random id kept in this browser. A sign-in from an id the account has never used raises an alert for the admins.
export function deviceId() {
  try {
    let d = localStorage.getItem('sd-device');
    if (!d) { d = crypto.randomUUID(); localStorage.setItem('sd-device', d); }
    return d;
  } catch (_) { return 'unknown'; }
}
export async function recordLogin() {
  try { await Promise.race([supabase.rpc('record_login', { p_device: deviceId() }), new Promise(r => setTimeout(r, 2500))]); } catch (_) { /* optional until features.sql is applied */ }
}

export async function logActivity(action, detail = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from('activity_logs').insert({ actor_id: user.id, action, detail });
  } catch (_) { /* logging must never break the app */ }
}
