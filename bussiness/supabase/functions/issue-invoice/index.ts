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
    const input = await req.json(); const items = Array.isArray(input.items) ? input.items : [];
    if (!input.client_id || items.length === 0 || items.some((x: any) => !x.description || Number(x.quantity) <= 0 || Number(x.unit_price) < 0)) return Response.json({ error: 'A client and valid invoice items are required' }, { status: 400, headers: cors });
    const subtotal = items.reduce((s: number, x: any) => s + Number(x.quantity) * Number(x.unit_price), 0);
    const discount = Math.max(0, Number(input.discount || 0)), taxRate = Math.max(0, Number(input.tax_rate || 0));
    if (discount > subtotal) return Response.json({ error: 'Discount cannot exceed subtotal' }, { status: 400, headers: cors });
    const total = Number(((subtotal - discount) * (1 + taxRate / 100)).toFixed(2));
    const { data: invoice, error } = await admin.from('invoices').insert({ client_id: input.client_id, project_id: input.project_id || null, status: 'Pending', subtotal, discount, tax_rate: taxRate, total, due_date: input.due_date || null, payment_terms: input.payment_terms || null, notes: input.notes || null, created_by: user.id }).select().single();
    if (error) throw error;
    const { error: itemError } = await admin.from('invoice_items').insert(items.map((x: any) => ({ invoice_id: invoice.id, description: x.description, quantity: Number(x.quantity), unit_price: Number(x.unit_price) })));
    if (itemError) { await admin.from('invoices').delete().eq('id', invoice.id); throw itemError; }
    return Response.json({ invoice }, { headers: cors });
  } catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 400, headers: cors }); }
});
