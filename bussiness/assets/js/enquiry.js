import { supabase } from './supabase.js';
if (localStorage.getItem('sd-theme') === 'dark') document.documentElement.classList.add('dark');

const form = document.querySelector('#enquiry-form');
const error = form.querySelector('.form-error'), ok = form.querySelector('.form-ok');
const button = form.querySelector('button[type=submit]');
const COOLDOWN_KEY = 'sd-enquiry-last';

form.addEventListener('submit', async event => {
  event.preventDefault();
  error.textContent = ''; ok.textContent = '';
  const d = Object.fromEntries(new FormData(form));
  const name = String(d.name || '').trim(), email = String(d.email || '').trim();
  if (name.length < 2) { error.textContent = 'Please enter your name.'; return; }
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/.test(email)) { error.textContent = 'Please enter a valid email address.'; return; }
  try { if (Date.now() - Number(localStorage.getItem(COOLDOWN_KEY) || 0) < 30000) { error.textContent = 'Please wait a moment before sending again.'; return; } } catch (_) { /* private mode */ }
  button.disabled = true; button.textContent = 'Sending…';
  try {
    // The database validates, de-duplicates, rate-limits and creates the client record (see submit_enquiry in supabase/security.sql).
    const { data, error: rpcError } = await supabase.rpc('submit_enquiry', { p_name: name, p_email: email, p_phone: d.phone || null, p_message: d.message || null, p_website: d.website || null });
    if (rpcError) throw new Error('Something went wrong. Please try again later.');
    if (!data?.ok) throw new Error(data?.error || 'Something went wrong. Please try again later.');
    try { localStorage.setItem(COOLDOWN_KEY, String(Date.now())); } catch (_) { /* ignore */ }
    form.reset(); ok.textContent = 'Thank you! We have received your details and will be in touch soon.';
  } catch (e) { error.textContent = e.message; }
  button.disabled = false; button.textContent = 'Send';
});
