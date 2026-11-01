// Database Webhook target: when a row is inserted into public.notifications, e-mail that admin.
// Secrets: WEBHOOK_SECRET, RESEND_API_KEY, FROM_EMAIL (+ SITE_URL for the link).
import { createClient } from 'npm:@supabase/supabase-js@2';
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
Deno.serve(async (req) => {
  const secret = Deno.env.get('WEBHOOK_SECRET');
  const given = req.headers.get('x-webhook-secret') || '';
  if (!secret || given.length !== secret.length) return new Response('forbidden', { status: 403 });
  let diff = 0; for (let i = 0; i < secret.length; i++) diff |= given.charCodeAt(i) ^ secret.charCodeAt(i);
  if (diff !== 0) return new Response('forbidden', { status: 403 });
  try {
    const payload = await req.json();
    if (payload.type !== 'INSERT' || payload.table !== 'notifications') return Response.json({ skipped: true });
    const n = payload.record;
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: prof } = await admin.from('profiles').select('email,role').eq('id', n.user_id).single();
    if (!prof?.email || prof.role !== 'admin') return Response.json({ skipped: true });   // only e-mail admins
    const site = (Deno.env.get('SITE_URL') || '').replace(/\/$/, '');
    const link = n.link && site ? `${site}/pages/${String(n.link).replace(/^\/+/, '')}` : '';
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: Deno.env.get('FROM_EMAIL'), to: [prof.email], subject: String(n.title).slice(0, 150),
        html: `<p><b>${esc(n.title)}</b></p><p>${esc(n.body)}</p>${link ? `<p><a href="${esc(link)}">Open in StudioDesk</a></p>` : ''}`
      })
    });
    if (!res.ok) return Response.json({ error: 'email provider rejected the request' }, { status: 502 });
    return Response.json({ sent: true });
  } catch (e) { return Response.json({ error: String((e as Error)?.message || e) }, { status: 400 }); }
});
