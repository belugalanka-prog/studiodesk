import { supabase } from './supabase.js';
import { escapeHTML as h } from './common.js';
if (localStorage.getItem('sd-theme') === 'dark') document.documentElement.classList.add('dark');

const $ = s => document.querySelector(s);
const box = $('#mfa-box'), err = $('#mfa-error'), title = $('#mfa-title'), sub = $('#mfa-sub');
const DASH = 'pages/dashboard.html';
const fail = m => { err.textContent = m; };
$('#mfa-signout').addEventListener('click', async e => { e.preventDefault(); await supabase.auth.signOut(); location.replace('login.html'); });

const { data: { user } } = await supabase.auth.getUser();
if (!user) location.replace('login.html');
const { data: prof } = user ? await supabase.from('profiles').select('role').eq('id', user.id).maybeSingle() : { data: null };
if (user && prof?.role !== 'admin') location.replace('client-login.html');

const codeField = `<label>6-digit code<input id="mfa-code" class="field" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" maxlength="6" required placeholder="123456"></label>`;

async function verify(factorId, code) {
  const ch = await supabase.auth.mfa.challenge({ factorId });
  if (ch.error) throw ch.error;
  const v = await supabase.auth.mfa.verify({ factorId, challengeId: ch.data.id, code });
  if (v.error) throw v.error;
}

function challenge(factorId) {
  title.textContent = 'Enter your code'; sub.textContent = 'Open your authenticator app and type the 6-digit code for StudioDesk.';
  box.innerHTML = `<form id="mfa-form">${codeField}<button class="button primary full" type="submit">Verify</button></form>`;
  $('#mfa-code').focus();
  $('#mfa-form').addEventListener('submit', async e => {
    e.preventDefault(); fail('');
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await verify(factorId, $('#mfa-code').value.trim()); location.replace(DASH); }
    catch (ex) { fail('That code was not accepted. Wait for a fresh code and try again.'); $('#mfa-code').value = ''; btn.disabled = false; }
  });
}

async function enroll() {
  title.textContent = 'Set up two-step verification';
  sub.textContent = 'Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…), then enter the code it shows.';
  // discard half-finished attempts so they don't pile up
  const { data: all } = await supabase.auth.mfa.listFactors();
  for (const f of (all?.all || []).filter(f => f.factor_type === 'totp' && f.status === 'unverified')) await supabase.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName: `StudioDesk ${new Date().toISOString().slice(0, 16)}` });
  if (error) { fail(/disabled|not enabled/i.test(error.message) ? 'MFA is switched off for this project. In Supabase go to Authentication → Sign In / Providers → Multi-Factor and enable TOTP.' : error.message); return; }
  box.innerHTML = `<div class="qr"><img alt="QR code to scan with your authenticator app" src="${h(data.totp.qr_code)}" width="180" height="180"></div><p class="small muted">Can’t scan? Enter this key manually:<br><code class="secret">${h(data.totp.secret)}</code></p><form id="mfa-form">${codeField}<button class="button primary full" type="submit">Turn on two-step verification</button></form>`;
  $('#mfa-code').focus();
  $('#mfa-form').addEventListener('submit', async e => {
    e.preventDefault(); fail('');
    const btn = e.target.querySelector('button'); btn.disabled = true;
    try { await verify(data.id, $('#mfa-code').value.trim()); location.replace(DASH); }
    catch (ex) { fail('That code was not accepted. Check the time on your phone and try again.'); $('#mfa-code').value = ''; btn.disabled = false; }
  });
}

if (user && prof?.role === 'admin') {
  try {
    const [{ data: aal }, { data: f }] = await Promise.all([supabase.auth.mfa.getAuthenticatorAssuranceLevel(), supabase.auth.mfa.listFactors()]);
    const verified = f?.totp?.[0];                       // listFactors().totp contains verified factors only
    if (verified && aal?.currentLevel === 'aal2') location.replace(DASH);
    else if (verified) challenge(verified.id);
    else await enroll();
  } catch (ex) { fail(ex.message || 'Something went wrong.'); }
}
