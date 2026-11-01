import { supabase } from './supabase.js';
if (localStorage.getItem('sd-theme') === 'dark') document.documentElement.classList.add('dark');

const $ = s => document.querySelector(s);
const form = $('#mfa-form'), error = form.querySelector('.form-error'), ok = form.querySelector('.form-ok');
const mode = new URLSearchParams(location.search).get('mode') === 'enroll' ? 'enroll' : 'verify';
let factorId = null;

const { data: { user } } = await supabase.auth.getUser();
if (!user) { location.replace('login.html'); }

$('#mfa-out').addEventListener('click', async e => { e.preventDefault(); await supabase.auth.signOut(); location.href = 'login.html'; });

async function init() {
  if (mode === 'enroll') {
    $('#mfa-title').textContent = 'Set up two-step verification';
    $('#mfa-help').textContent = 'Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, Authy, 1Password…), then enter the 6-digit code it shows.';
    $('#mfa-skip').hidden = false;
    // remove abandoned, never-verified attempts first
    const { data: list } = await supabase.auth.mfa.listFactors();
    for (const f of list?.all || []) if (f.factor_type === 'totp' && f.status === 'unverified') await supabase.auth.mfa.unenroll({ factorId: f.id });
    const { data, error: e } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `StudioDesk ${new Date().toISOString().slice(0, 16)}` });
    if (e) { error.textContent = 'Could not start setup. Please try again.'; return; }
    factorId = data.id; $('#mfa-qr').src = data.totp.qr_code; $('#mfa-secret').textContent = data.totp.secret; $('#mfa-setup').hidden = false;
  } else {
    $('#mfa-help').textContent = 'Enter the 6-digit code from your authenticator app.';
    const { data } = await supabase.auth.mfa.listFactors();
    factorId = data?.totp?.[0]?.id;
    if (!factorId) location.replace('mfa.html?mode=enroll');
  }
}
if (user) await init();

form.addEventListener('submit', async e => {
  e.preventDefault(); error.textContent = ''; ok.textContent = '';
  const code = String(new FormData(form).get('code') || '').trim();
  if (!/^\d{6}$/.test(code)) { error.textContent = 'Enter the 6-digit code.'; return; }
  const btn = form.querySelector('button'); btn.disabled = true;
  const { error: e } = await supabase.auth.mfa.challengeAndVerify({ factorId, code });
  if (e) { error.textContent = 'That code is not correct. Check the time on your phone and try again.'; form.elements.code.value = ''; btn.disabled = false; return; }
  ok.textContent = 'Verified. Redirecting…'; setTimeout(() => location.replace('pages/dashboard.html'), 600);
});
