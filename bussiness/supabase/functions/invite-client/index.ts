// Admin-only: e-mails a portal invitation to a client and links the new login to the client record.
import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': Deno.env.get('SITE_URL') || '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: cors });
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const siteUrl = Deno.env.get('SITE_URL');
    if (!siteUrl) return json({ error: 'SITE_URL secret is not set' }, 500);
    const caller = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: { user } } = await caller.auth.getUser();
    if (!user) return json({ error: 'Authentication required' }, 401);
    const admin = createClient(url, service);
    const { data: me } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (me?.role !== 'admin') return json({ error: 'Administrator access required' }, 403);

    const { client_id } = await req.json();
    if (typeof client_id !== 'string') return json({ error: 'client_id required' }, 400);
    const { data: client } = await admin.from('clients').select('id,name,email,archived_at').eq('id', client_id).single();
    if (!client || client.archived_at) return json({ error: 'Active client not found' }, 404);

    // existing login for this e-mail?
    let { data: prof } = await admin.from('profiles').select('id,role').ilike('email', client.email.replace(/[\\%_]/g, '\\$&')).maybeSingle();
    let invited = false;
    if (!prof) {
      const { data, error } = await admin.auth.admin.inviteUserByEmail(client.email, { data: { full_name: client.name }, redirectTo: `${siteUrl.replace(/\/$/, '')}/client-login.html` });
      if (error) return json({ error: error.message }, 400);
      invited = true;
      // the profile row is created by a trigger; read it back
      ({ data: prof } = await admin.from('profiles').select('id,role').eq('id', data.user.id).single());
    }
    if (!prof || prof.role !== 'client') return json({ error: 'That e-mail belongs to an administrator account' }, 400);
    const { error: linkErr } = await admin.from('client_users').upsert({ client_id: client.id, user_id: prof.id }, { onConflict: 'user_id', ignoreDuplicates: true });
    if (linkErr) return json({ error: linkErr.message }, 400);
    await admin.from('activity_logs').insert({ actor_id: user.id, client_id: client.id, action: invited ? 'Portal invitation sent' : 'Portal account linked', detail: { email: client.email } });
    return json({ ok: true, invited });
  } catch (e) { return json({ error: String((e as Error)?.message || e) }, 400); }
});
