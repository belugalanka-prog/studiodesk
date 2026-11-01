-- StudioDesk upgrade: service presets, atomic invoice/quotation functions, smarter statuses.
-- Safe to run more than once. Run AFTER schema.sql / fixes.sql, in Supabase -> SQL Editor.

alter table public.business_settings add column if not exists bank_details text;

-- ---------- invoice status logic (one source of truth) ----------
create or replace function public.compute_invoice_status(p_id uuid) returns public.invoice_status language sql stable as $$
  select case
    when i.status='Void' then 'Void'::public.invoice_status
    when i.total>0 and pd.paid>=i.total then 'Paid'::public.invoice_status
    when i.due_date is not null and i.due_date<current_date then 'Overdue'::public.invoice_status
    when pd.paid>0 then 'Partially Paid'::public.invoice_status
    else 'Pending'::public.invoice_status end
  from public.invoices i, lateral (select coalesce(sum(amount),0) as paid from public.payments where invoice_id=i.id and verified) pd
  where i.id=p_id $$;

create or replace function public.refresh_invoice_status() returns trigger language plpgsql security definer set search_path=public as $$
declare inv uuid;
begin
  if tg_op='DELETE' then inv:=old.invoice_id; else inv:=new.invoice_id; end if;
  update public.invoices set status=public.compute_invoice_status(id) where id=inv and status<>'Void';
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

-- Admin-only: persist "Overdue" for invoices whose due date has passed (called when the admin app opens).
create or replace function public.sync_invoice_statuses() returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_admin() then return; end if;
  update public.invoices i set status=public.compute_invoice_status(i.id)
  where i.status in ('Pending','Partially Paid','Overdue') and i.status<>public.compute_invoice_status(i.id);
end $$;

-- ---------- create quotation (atomic, totals calculated on the server) ----------
create or replace function public.create_quotation(p_client uuid, p_project uuid, p_items jsonb, p_discount numeric, p_tax_rate numeric, p_valid_until date, p_notes text)
returns public.quotations language plpgsql security definer set search_path=public as $$
declare q public.quotations; sub numeric; tot numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_client is null then raise exception 'Choose a client'; end if;
  if p_project is not null and not exists(select 1 from public.projects where id=p_project and client_id=p_client) then raise exception 'That project belongs to a different client'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one line item'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where coalesce(trim(x->>'description'),'')='' or (x->>'quantity')::numeric<=0 or (x->>'unit_price')::numeric<0) then raise exception 'Each line needs a description, a quantity above zero and a price'; end if;
  select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into sub from jsonb_array_elements(p_items) x;
  p_discount:=greatest(coalesce(p_discount,0),0); p_tax_rate:=greatest(coalesce(p_tax_rate,0),0);
  if p_discount>sub then raise exception 'Discount cannot exceed the subtotal'; end if;
  tot:=round((sub-p_discount)*(1+p_tax_rate/100),2);
  if tot<=0 then raise exception 'Quotation total must be above zero'; end if;
  insert into public.quotations(client_id,project_id,status,subtotal,discount,tax_rate,total,valid_until,notes)
    values(p_client,p_project,'Draft',sub,p_discount,p_tax_rate,tot,p_valid_until,nullif(trim(p_notes),'')) returning * into q;
  insert into public.quotation_items(quotation_id,description,quantity,unit_price)
    select q.id,trim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric from jsonb_array_elements(p_items) x;
  return q;
end $$;

-- ---------- create invoice (atomic) ----------
create or replace function public.create_invoice(p_client uuid, p_project uuid, p_items jsonb, p_discount numeric, p_tax_rate numeric, p_due date, p_terms text, p_notes text, p_quotation uuid default null)
returns public.invoices language plpgsql security definer set search_path=public as $$
declare inv public.invoices; sub numeric; tot numeric;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_client is null then raise exception 'Choose a client'; end if;
  if p_project is not null and not exists(select 1 from public.projects where id=p_project and client_id=p_client) then raise exception 'That project belongs to a different client'; end if;
  if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)=0 then raise exception 'Add at least one line item'; end if;
  if exists(select 1 from jsonb_array_elements(p_items) x where coalesce(trim(x->>'description'),'')='' or (x->>'quantity')::numeric<=0 or (x->>'unit_price')::numeric<0) then raise exception 'Each line needs a description, a quantity above zero and a price'; end if;
  select coalesce(sum((x->>'quantity')::numeric*(x->>'unit_price')::numeric),0) into sub from jsonb_array_elements(p_items) x;
  p_discount:=greatest(coalesce(p_discount,0),0); p_tax_rate:=greatest(coalesce(p_tax_rate,0),0);
  if p_discount>sub then raise exception 'Discount cannot exceed the subtotal'; end if;
  tot:=round((sub-p_discount)*(1+p_tax_rate/100),2);
  if tot<=0 then raise exception 'Invoice total must be above zero'; end if;
  insert into public.invoices(client_id,project_id,quotation_id,status,subtotal,discount,tax_rate,total,due_date,payment_terms,notes,created_by)
    values(p_client,p_project,p_quotation,'Pending',sub,p_discount,p_tax_rate,tot,p_due,nullif(trim(p_terms),''),nullif(trim(p_notes),''),auth.uid()) returning * into inv;
  insert into public.invoice_items(invoice_id,description,quantity,unit_price)
    select inv.id,trim(x->>'description'),(x->>'quantity')::numeric,(x->>'unit_price')::numeric from jsonb_array_elements(p_items) x;
  if p_quotation is not null then update public.quotations set status='Accepted' where id=p_quotation and status in ('Draft','Sent'); end if;
  update public.invoices set status=public.compute_invoice_status(id) where id=inv.id;
  select * into inv from public.invoices where id=inv.id;
  return inv;
end $$;

-- ---------- convert an accepted/sent quotation into an invoice ----------
create or replace function public.convert_quotation(p_quote uuid, p_due date, p_terms text)
returns public.invoices language plpgsql security definer set search_path=public as $$
declare q public.quotations; inv public.invoices;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into q from public.quotations where id=p_quote;
  if not found then raise exception 'Quotation not found'; end if;
  if q.status in ('Declined','Expired') then raise exception 'A % quotation cannot be invoiced', lower(q.status); end if;
  if exists(select 1 from public.invoices where quotation_id=p_quote and status<>'Void') then raise exception 'This quotation has already been invoiced'; end if;
  insert into public.invoices(client_id,project_id,quotation_id,status,subtotal,discount,tax_rate,total,due_date,payment_terms,notes,created_by)
    values(q.client_id,q.project_id,q.id,'Pending',q.subtotal,q.discount,q.tax_rate,q.total,p_due,nullif(trim(p_terms),''),q.notes,auth.uid()) returning * into inv;
  insert into public.invoice_items(invoice_id,description,quantity,unit_price) select inv.id,description,quantity,unit_price from public.quotation_items where quotation_id=q.id;
  update public.quotations set status='Accepted' where id=q.id;
  update public.projects set status='Confirmed' where id=q.project_id and status in ('New Enquiry','Quotation Sent','Awaiting Confirmation');
  update public.invoices set status=public.compute_invoice_status(id) where id=inv.id;
  select * into inv from public.invoices where id=inv.id;
  return inv;
end $$;

-- ---------- quotation status (admin) with project follow-through ----------
create or replace function public.set_quotation_status(p_id uuid, p_status text) returns public.quotations language plpgsql security definer set search_path=public as $$
declare q public.quotations;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  if p_status not in ('Draft','Sent','Accepted','Declined','Expired') then raise exception 'Invalid status'; end if;
  update public.quotations set status=p_status where id=p_id returning * into q;
  if not found then raise exception 'Quotation not found'; end if;
  if q.project_id is not null then
    if p_status='Sent' then update public.projects set status='Quotation Sent' where id=q.project_id and status='New Enquiry'; end if;
    if p_status='Accepted' then update public.projects set status='Confirmed' where id=q.project_id and status in ('New Enquiry','Quotation Sent','Awaiting Confirmation'); end if;
  end if;
  return q;
end $$;

-- ---------- client accepts / declines a sent quotation ----------
create or replace function public.respond_quotation(p_id uuid, p_accept boolean) returns public.quotations language plpgsql security definer set search_path=public as $$
declare q public.quotations;
begin
  select * into q from public.quotations where id=p_id;
  if not found or not exists(select 1 from public.client_users where client_id=q.client_id and user_id=auth.uid()) then raise exception 'Quotation not found'; end if;
  if q.status<>'Sent' then raise exception 'This quotation can no longer be answered'; end if;
  if q.valid_until is not null and q.valid_until<current_date then raise exception 'This quotation has expired'; end if;
  update public.quotations set status=case when p_accept then 'Accepted' else 'Declined' end where id=p_id returning * into q;
  if p_accept and q.project_id is not null then update public.projects set status='Confirmed' where id=q.project_id and status in ('New Enquiry','Quotation Sent','Awaiting Confirmation'); end if;
  return q;
end $$;

-- ---------- record a payment (validated) ----------
create or replace function public.record_payment(p_invoice uuid, p_amount numeric, p_method text, p_reference text, p_paid_on date)
returns public.payments language plpgsql security definer set search_path=public as $$
declare inv public.invoices; paid numeric; pay public.payments;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into inv from public.invoices where id=p_invoice;
  if not found or inv.status='Void' then raise exception 'Choose a valid, non-void invoice'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Enter an amount above zero'; end if;
  if p_method not in ('Bank transfer','Cash','Card','Other') then raise exception 'Unsupported payment method'; end if;
  select coalesce(sum(amount),0) into paid from public.payments where invoice_id=p_invoice and verified;
  if p_amount>inv.total-paid+0.005 then raise exception 'Amount exceeds the remaining balance of %', (inv.total-paid); end if;
  insert into public.payments(invoice_id,amount,method,reference,verified,recorded_by,paid_at)
    values(p_invoice,p_amount,p_method,nullif(trim(p_reference),''),true,auth.uid(),coalesce(p_paid_on,current_date)::timestamp+time '12:00') returning * into pay;
  return pay;
end $$;

-- ---------- void / reopen invoice ----------
create or replace function public.set_invoice_void(p_id uuid, p_void boolean) returns public.invoices language plpgsql security definer set search_path=public as $$
declare inv public.invoices;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.invoices set status=case when p_void then 'Void'::public.invoice_status else 'Pending'::public.invoice_status end where id=p_id returning * into inv;
  if not found then raise exception 'Invoice not found'; end if;
  if not p_void then update public.invoices set status=public.compute_invoice_status(id) where id=p_id returning * into inv; end if;
  return inv;
end $$;

grant execute on function public.create_quotation(uuid,uuid,jsonb,numeric,numeric,date,text), public.create_invoice(uuid,uuid,jsonb,numeric,numeric,date,text,text,uuid), public.convert_quotation(uuid,date,text), public.set_quotation_status(uuid,text), public.respond_quotation(uuid,boolean), public.record_payment(uuid,numeric,text,text,date), public.set_invoice_void(uuid,boolean), public.sync_invoice_statuses() to authenticated;

-- Clients should not see draft quotations.
drop policy if exists "clients read own quotations" on public.quotations;
create policy "clients read own quotations" on public.quotations for select using(status<>'Draft' and exists(select 1 from public.client_users cu where cu.client_id=public.quotations.client_id and cu.user_id=auth.uid()));
drop policy if exists "client reads own quote lines" on public.quotation_items;
create policy "client reads own quote lines" on public.quotation_items for select using(exists(select 1 from public.quotations q join public.client_users cu on cu.client_id=q.client_id where q.id=quotation_id and q.status<>'Draft' and cu.user_id=auth.uid()));

-- Starter service presets (prices are placeholders: edit them under Services in the app).
insert into public.services(name,description,unit_price)
select * from (values
 ('Logo design','Logo concepts, revisions and final files',25000),
 ('Brand identity package','Logo, colour palette, typography and brand guide',85000),
 ('Social media post design','Single post or story design',3500),
 ('Flyer / poster design','Print-ready flyer or poster',8000),
 ('Photo shoot (half day)','Up to 4 hours on location, edited selects',40000),
 ('Photo editing / retouching','Per image colour correction and retouching',1500),
 ('Video shoot (half day)','Up to 4 hours of filming with crew',60000),
 ('Video editing','Per finished minute, including colour and sound',8000),
 ('Advertising campaign','Concept, creatives and delivery for a campaign',50000),
 ('Additional revision round','One extra round of changes',5000)
) as v(name,description,unit_price) where not exists(select 1 from public.services);
