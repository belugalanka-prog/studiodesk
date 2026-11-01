import { createClient } from 'npm:@supabase/supabase-js@2';
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth = createClient(url, anon, { global: { headers: { Authorization: req.headers.get('Authorization') || '' } } });
    const { data: { user } } = await auth.auth.getUser(); if (!user) return Response.json({ error: 'Authentication required' }, { status: 401, headers: cors });
    const admin = createClient(url, service); const { data: profile } = await admin.from('profiles').select('role').eq('id', user.id).single();
    if (profile?.role !== 'admin') return Response.json({ error: 'Administrator access required' }, { status: 403, headers: cors });
    const input = await req.json(), amount = Number(input.amount);
    if (!input.invoice_id || !Number.isFinite(amount) || amount <= 0 || !['Cash','Bank transfer','Card','Other'].includes(input.method)) return Response.json({ error: 'Invoice, positive amount, and supported method are required' }, { status: 400, headers: cors });
    const { data: invoice } = await admin.from('invoices').select('id,total,status').eq('id', input.invoice_id).single();
    if (!invoice || invoice.status === 'Void') return Response.json({ error: 'Valid non-void invoice required' }, { status: 404, headers: cors });
    const { data: current } = await admin.from('payments').select('amount').eq('invoice_id', invoice.id).eq('verified', true);
    const alreadyPaid = (current || []).reduce((n: number, p: any) => n + Number(p.amount), 0);
    if (amount + alreadyPaid > Number(invoice.total) + 0.005) return Response.json({ error: 'Payment exceeds the remaining invoice balance' }, { status: 400, headers: cors });
    const { data: payment, error } = await admin.from('payments').insert({ invoice_id: invoice.id, amount, method: input.method, reference: input.reference || null, verified: true, recorded_by: user.id }).select().single();
    if (error) throw error;
    return Response.json({ payment, remaining_balance: Number(invoice.total) - alreadyPaid - amount }, { headers: cors });
  } catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 400, headers: cors }); }
});
