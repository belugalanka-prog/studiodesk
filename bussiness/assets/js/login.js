import { supabase } from './supabase.js';
const form = document.querySelector('#login-form');
form?.addEventListener('submit', async event => {
  event.preventDefault(); const error = form.querySelector('.form-error'); error.textContent = '';
  const data = Object.fromEntries(new FormData(form)); const { error: authError } = await supabase.auth.signInWithPassword({ email: data.email, password: data.password });
  if (authError) { error.textContent = authError.message; return; }
  location.href = location.pathname.endsWith('client-login.html') ? 'pages/client-dashboard.html' : 'pages/dashboard.html';
});
