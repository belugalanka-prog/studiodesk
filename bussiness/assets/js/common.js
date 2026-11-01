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

export async function requireUser(role) {
  const login = role === 'client' ? '../client-login.html' : '../login.html';
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) { location.replace(login); return null; }
  const { data: profile } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle();
  if (!profile) { await supabase.auth.signOut(); location.replace(`${login}?msg=noprofile`); return null; }
  if (profile.role !== role) { await supabase.auth.signOut(); location.replace(`${login}?msg=wrongrole`); return null; }
  if (role === 'admin') {   // second step (TOTP): verify if enrolled, enrol if the studio requires it
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    const base = location.pathname.includes('/pages/') ? '../' : '';
    if (aal?.nextLevel === 'aal2' && aal.currentLevel !== 'aal2') { location.replace(`${base}mfa.html?mode=verify`); return null; }
    if (aal?.currentLevel === 'aal1' && aal?.nextLevel === 'aal1') {
      const { data: s } = await supabase.from('business_settings').select('require_admin_mfa').eq('id', true).maybeSingle();
      if (s?.require_admin_mfa) { location.replace(`${base}mfa.html?mode=enroll`); return null; }
    }
  }
  return { user, profile };
}

export async function logActivity(action, detail = {}) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (user) await supabase.from('activity_logs').insert({ actor_id: user.id, action, detail });
  } catch (_) { /* logging must never break the app */ }
}
