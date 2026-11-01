-- Run once in the Supabase SQL editor. Admin role assignment is intentionally manual.
create extension if not exists pgcrypto;
do $$ begin create type public.user_role as enum ('admin','client'); exception when duplicate_object then null; end $$;
do $$ begin create type public.project_status as enum ('New Enquiry','Quotation Sent','Awaiting Confirmation','Confirmed','In Progress','Internal Review','Client Review','Revision Requested','Approved','Ready for Delivery','Completed','On Hold','Cancelled'); exception when duplicate_object then null; end $$;
do $$ begin create type public.invoice_status as enum ('Paid','Partially Paid','Pending','Overdue','Void'); exception when duplicate_object then null; end $$;
do $$ begin create type public.file_category as enum ('References','Original Photos','Raw Videos','Design Files','Previews','Edited Videos','Final Deliverables','Documents','Invoices','Receipts'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles(id uuid primary key references auth.users on delete cascade, role public.user_role not null default 'client', full_name text not null default '', email text not null default '', created_at timestamptz not null default now());
create or replace function public.on_auth_user_created() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,email,full_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','')); return new; end $$;
drop trigger if exists auth_user_profile on auth.users;
create trigger auth_user_profile after insert on auth.users for each row execute function public.on_auth_user_created();
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;

create table if not exists public.clients(id uuid primary key default gen_random_uuid(), name text not null, business_name text, phone text, email text not null, address text, social_links jsonb not null default '{}', notes text, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.client_users(client_id uuid not null references public.clients on delete cascade, user_id uuid not null unique references public.profiles on delete cascade, created_at timestamptz not null default now(), primary key(client_id,user_id));
create table if not exists public.services(id uuid primary key default gen_random_uuid(), name text not null, description text, unit_price numeric(12,2) not null default 0 check(unit_price>=0), active boolean not null default true, created_at timestamptz not null default now());
create table if not exists public.projects(id uuid primary key default gen_random_uuid(), project_code bigint generated always as identity unique, client_id uuid not null references public.clients, title text not null, category text not null default 'Other', description text, agreed_price numeric(12,2) not null default 0 check(agreed_price>=0), status public.project_status not null default 'New Enquiry', priority text not null default 'Normal' check(priority in ('Low','Normal','High','Urgent')), progress smallint not null default 0 check(progress between 0 and 100), start_date date, deadline date, assigned_staff text, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table if not exists public.project_tasks(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, title text not null, description text, due_date date, completed boolean not null default false, assigned_to text, created_at timestamptz not null default now());
create table if not exists public.project_updates(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, author_id uuid not null references public.profiles, body text not null, update_type text not null default 'update', visible_to_client boolean not null default true, created_at timestamptz not null default now());
create table if not exists public.project_files(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, uploaded_by uuid not null references public.profiles, storage_path text not null unique, name text not null, category public.file_category not null default 'Documents', visible_to_client boolean not null default false, version integer not null default 1 check(version>0), mime_type text, size_bytes bigint, created_at timestamptz not null default now());
create table if not exists public.deliverables(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, file_id uuid references public.project_files on delete set null, approved_by uuid references public.profiles, approved_at timestamptz, feedback text, created_at timestamptz not null default now());
create table if not exists public.quotations(id uuid primary key default gen_random_uuid(), quote_number bigint generated always as identity unique, client_id uuid not null references public.clients, project_id uuid references public.projects, status text not null default 'Draft' check(status in ('Draft','Sent','Accepted','Declined','Expired')), subtotal numeric(12,2) not null default 0, discount numeric(12,2) not null default 0, tax_rate numeric(6,3) not null default 0, total numeric(12,2) not null default 0, valid_until date, notes text, created_at timestamptz not null default now());
create table if not exists public.quotation_items(id uuid primary key default gen_random_uuid(), quotation_id uuid not null references public.quotations on delete cascade, description text not null, quantity numeric(10,2) not null default 1 check(quantity>0), unit_price numeric(12,2) not null default 0 check(unit_price>=0));
create table if not exists public.invoices(id uuid primary key default gen_random_uuid(), invoice_number bigint generated always as identity unique, client_id uuid not null references public.clients, project_id uuid references public.projects, quotation_id uuid references public.quotations, status public.invoice_status not null default 'Pending', subtotal numeric(12,2) not null default 0, discount numeric(12,2) not null default 0, tax_rate numeric(6,3) not null default 0, total numeric(12,2) not null default 0, issue_date date not null default current_date, due_date date, payment_terms text, notes text, created_by uuid references public.profiles, created_at timestamptz not null default now());
create table if not exists public.invoice_items(id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices on delete cascade, description text not null, quantity numeric(10,2) not null default 1 check(quantity>0), unit_price numeric(12,2) not null default 0 check(unit_price>=0));
create table if not exists public.payments(id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices on delete cascade, amount numeric(12,2) not null check(amount>0), method text not null default 'Bank transfer', reference text, verified boolean not null default false, recorded_by uuid references public.profiles, paid_at timestamptz not null default now(), created_at timestamptz not null default now());
create table if not exists public.messages(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, sender_id uuid not null references public.profiles, body text not null, attachment_path text, created_at timestamptz not null default now());
create table if not exists public.message_reads(message_id uuid not null references public.messages on delete cascade, user_id uuid not null references public.profiles on delete cascade, read_at timestamptz not null default now(), primary key(message_id,user_id));
create table if not exists public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, title text not null, body text, link text, read_at timestamptz, created_at timestamptz not null default now());
create table if not exists public.activity_logs(id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles, client_id uuid references public.clients on delete set null, project_id uuid references public.projects on delete set null, action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now());
create table if not exists public.business_settings(id boolean primary key default true check(id), business_name text not null default 'StudioDesk', currency text not null default 'LKR', tax_rate numeric(6,3) not null default 0, logo_path text, address text, phone text, email text, payment_terms text default 'Due within 14 days', updated_at timestamptz not null default now());
insert into public.business_settings(id) values(true) on conflict do nothing;

create index if not exists projects_client_idx on public.projects(client_id); create index if not exists projects_status_idx on public.projects(status); create index if not exists projects_deadline_idx on public.projects(deadline); create index if not exists invoices_client_idx on public.invoices(client_id); create index if not exists invoices_due_idx on public.invoices(due_date); create index if not exists payments_invoice_idx on public.payments(invoice_id); create index if not exists files_project_idx on public.project_files(project_id); create index if not exists messages_project_time_idx on public.messages(project_id,created_at); create index if not exists clients_email_idx on public.clients(lower(email));

-- Auto calculate invoice payment status after verified payment changes.
create or replace function public.refresh_invoice_status() returns trigger language plpgsql security definer set search_path=public as $$ declare inv uuid; paid numeric; total_due numeric; begin inv=coalesce(new.invoice_id,old.invoice_id); select total into total_due from public.invoices where id=inv; select coalesce(sum(amount),0) into paid from public.payments where invoice_id=inv and verified; update public.invoices set status=case when paid>=total_due and total_due>0 then 'Paid'::public.invoice_status when paid>0 then 'Partially Paid'::public.invoice_status when due_date<current_date then 'Overdue'::public.invoice_status else 'Pending'::public.invoice_status end where id=inv and status<>'Void'; return coalesce(new,old); end $$;
drop trigger if exists payment_status_refresh on public.payments;
create trigger payment_status_refresh after insert or update or delete on public.payments for each row execute function public.refresh_invoice_status();

alter table public.profiles enable row level security; alter table public.clients enable row level security; alter table public.client_users enable row level security; alter table public.services enable row level security; alter table public.projects enable row level security; alter table public.project_tasks enable row level security; alter table public.project_updates enable row level security; alter table public.project_files enable row level security; alter table public.deliverables enable row level security; alter table public.quotations enable row level security; alter table public.quotation_items enable row level security; alter table public.invoices enable row level security; alter table public.invoice_items enable row level security; alter table public.payments enable row level security; alter table public.messages enable row level security; alter table public.message_reads enable row level security; alter table public.notifications enable row level security; alter table public.activity_logs enable row level security; alter table public.business_settings enable row level security;

drop policy if exists "profile self or admin read" on public.profiles; create policy "profile self or admin read" on public.profiles for select using(id=auth.uid() or public.is_admin());
drop policy if exists "profile self update" on public.profiles; create policy "profile self update" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());
drop policy if exists "admins manage clients" on public.clients; create policy "admins manage clients" on public.clients for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own client" on public.clients; create policy "client reads own client" on public.clients for select using(exists(select 1 from public.client_users cu where cu.client_id=id and cu.user_id=auth.uid()));
drop policy if exists "admin manages client links" on public.client_users; create policy "admin manages client links" on public.client_users for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client sees own link" on public.client_users; create policy "client sees own link" on public.client_users for select using(user_id=auth.uid());
drop policy if exists "admin manages services" on public.services; create policy "admin manages services" on public.services for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "authenticated sees active services" on public.services; create policy "authenticated sees active services" on public.services for select to authenticated using(active);
drop policy if exists "admin manages projects" on public.projects; create policy "admin manages projects" on public.projects for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own projects" on public.projects; create policy "client reads own projects" on public.projects for select using(exists(select 1 from public.client_users cu where cu.client_id=public.projects.client_id and cu.user_id=auth.uid()));
drop policy if exists "admin manages tasks" on public.project_tasks; create policy "admin manages tasks" on public.project_tasks for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own tasks" on public.project_tasks; create policy "client reads own tasks" on public.project_tasks for select using(exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
drop policy if exists "admins manage updates" on public.project_updates; create policy "admins manage updates" on public.project_updates for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads visible updates" on public.project_updates; create policy "client reads visible updates" on public.project_updates for select using(visible_to_client and exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
drop policy if exists "admins manage files" on public.project_files; create policy "admins manage files" on public.project_files for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads permitted files" on public.project_files; create policy "client reads permitted files" on public.project_files for select using(visible_to_client and exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
drop policy if exists "admin manages deliverables" on public.deliverables; create policy "admin manages deliverables" on public.deliverables for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client sees own deliverables" on public.deliverables; create policy "client sees own deliverables" on public.deliverables for select using(exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
drop policy if exists "admins manage quotations" on public.quotations; create policy "admins manage quotations" on public.quotations for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "clients read own quotations" on public.quotations; create policy "clients read own quotations" on public.quotations for select using(exists(select 1 from public.client_users cu where cu.client_id=public.quotations.client_id and cu.user_id=auth.uid()));
drop policy if exists "admin manages quote lines" on public.quotation_items; create policy "admin manages quote lines" on public.quotation_items for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own quote lines" on public.quotation_items; create policy "client reads own quote lines" on public.quotation_items for select using(exists(select 1 from public.quotations q join public.client_users cu on cu.client_id=q.client_id where q.id=quotation_id and cu.user_id=auth.uid()));
drop policy if exists "admin manages invoices" on public.invoices; create policy "admin manages invoices" on public.invoices for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own invoices" on public.invoices; create policy "client reads own invoices" on public.invoices for select using(exists(select 1 from public.client_users cu where cu.client_id=public.invoices.client_id and cu.user_id=auth.uid()));
drop policy if exists "admin manages invoice lines" on public.invoice_items; create policy "admin manages invoice lines" on public.invoice_items for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own invoice lines" on public.invoice_items; create policy "client reads own invoice lines" on public.invoice_items for select using(exists(select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=invoice_id and cu.user_id=auth.uid()));
drop policy if exists "admin manages payments" on public.payments; create policy "admin manages payments" on public.payments for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads verified own payments" on public.payments; create policy "client reads verified own payments" on public.payments for select using(verified and exists(select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=invoice_id and cu.user_id=auth.uid()));
drop policy if exists "admin manages messages" on public.messages; create policy "admin manages messages" on public.messages for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own messages" on public.messages; create policy "client reads own messages" on public.messages for select using(exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
drop policy if exists "client sends own messages" on public.messages; create policy "client sends own messages" on public.messages for insert with check(sender_id=auth.uid() and exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
drop policy if exists "users manage own reads" on public.message_reads; create policy "users manage own reads" on public.message_reads for all using(user_id=auth.uid() or public.is_admin()) with check(user_id=auth.uid() or public.is_admin());
drop policy if exists "users read own notifications" on public.notifications; create policy "users read own notifications" on public.notifications for all using(user_id=auth.uid() or public.is_admin()) with check(user_id=auth.uid() or public.is_admin());
drop policy if exists "admin reads activity" on public.activity_logs; create policy "admin reads activity" on public.activity_logs for select using(public.is_admin()); drop policy if exists "authenticated logs activity" on public.activity_logs; create policy "authenticated logs activity" on public.activity_logs for insert to authenticated with check(actor_id=auth.uid());
drop policy if exists "admin manages business settings" on public.business_settings; create policy "admin manages business settings" on public.business_settings for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "authenticated reads business settings" on public.business_settings; create policy "authenticated reads business settings" on public.business_settings for select to authenticated using(true);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('project-files','project-files',false,524288000,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','application/pdf','application/zip','application/octet-stream']) on conflict(id) do nothing;
drop policy if exists "admin manages project storage" on storage.objects; create policy "admin manages project storage" on storage.objects for all to authenticated using(bucket_id='project-files' and public.is_admin()) with check(bucket_id='project-files' and public.is_admin());
drop policy if exists "client reads visible project storage" on storage.objects; create policy "client reads visible project storage" on storage.objects for select to authenticated using(bucket_id='project-files' and exists(select 1 from public.project_files f join public.projects p on p.id=f.project_id join public.client_users cu on cu.client_id=p.client_id where f.storage_path=name and f.visible_to_client and cu.user_id=auth.uid()));


-- ===== fixes (same as supabase/fixes.sql) =====
-- StudioDesk fixes. Safe to run more than once. Run in Supabase -> SQL Editor.
-- (Already included at the end of schema.sql for brand-new projects.)

-- 1. Security: stop a client from changing their own role to "admin".
create or replace function public.prevent_role_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role is distinct from old.role and auth.uid() is not null and not public.is_admin() then
    raise exception 'Only an administrator can change a role';
  end if;
  return new;
end $$;
drop trigger if exists profiles_role_guard on public.profiles;
drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard before update on public.profiles for each row execute function public.prevent_role_change();

-- 2. Client file downloads: "name" was ambiguous (project_files.name vs storage.objects.name).
drop policy if exists "client reads visible project storage" on storage.objects;
drop policy if exists "client reads visible project storage" on storage.objects; create policy "client reads visible project storage" on storage.objects for select to authenticated using(
  bucket_id='project-files' and exists(
    select 1 from public.project_files f
    join public.projects p on p.id=f.project_id
    join public.client_users cu on cu.client_id=p.client_id
    where f.storage_path=storage.objects.name and f.visible_to_client and cu.user_id=auth.uid()));

-- 3. Allow common document, audio and design file types for uploads.
update storage.buckets set allowed_mime_types = array[
  'image/jpeg','image/png','image/webp','image/gif','image/svg+xml','image/heic','image/vnd.adobe.photoshop',
  'video/mp4','video/quicktime','video/webm','audio/mpeg','audio/wav','audio/mp4',
  'application/pdf','application/zip','application/octet-stream','application/postscript',
  'application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'text/plain','text/csv'] where id='project-files';

-- 4. Keep updated_at accurate.
create or replace function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at=now(); return new; end $$;
drop trigger if exists clients_touch on public.clients; create trigger clients_touch before update on public.clients for each row execute function public.touch_updated_at();
drop trigger if exists projects_touch on public.projects; create trigger projects_touch before update on public.projects for each row execute function public.touch_updated_at();
drop trigger if exists settings_touch on public.business_settings; create trigger settings_touch before update on public.business_settings for each row execute function public.touch_updated_at();

-- 5. Clearer client policy (qualified column).
drop policy if exists "client reads own client" on public.clients;
drop policy if exists "client reads own client" on public.clients; create policy "client reads own client" on public.clients for select using(exists(select 1 from public.client_users cu where cu.client_id=public.clients.id and cu.user_id=auth.uid()));


-- ===== upgrade (same as supabase/upgrade.sql) =====
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
drop policy if exists "clients read own quotations" on public.quotations; create policy "clients read own quotations" on public.quotations for select using(status<>'Draft' and exists(select 1 from public.client_users cu where cu.client_id=public.quotations.client_id and cu.user_id=auth.uid()));
drop policy if exists "client reads own quote lines" on public.quotation_items;
drop policy if exists "client reads own quote lines" on public.quotation_items; create policy "client reads own quote lines" on public.quotation_items for select using(exists(select 1 from public.quotations q join public.client_users cu on cu.client_id=q.client_id where q.id=quotation_id and q.status<>'Draft' and cu.user_id=auth.uid()));

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


-- ===== auto-link (same as supabase/autolink.sql) =====
-- Auto-link portal accounts to clients by matching email (no Edge Function needed).
-- Create the user in Supabase -> Authentication -> Users with the same email as the client record and they are linked automatically.
create or replace function public.autolink_profile() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if new.role='client' and not exists(select 1 from public.client_users where user_id=new.id) then
    insert into public.client_users(client_id,user_id)
    select c.id,new.id from public.clients c where lower(c.email)=lower(new.email) and c.archived_at is null order by c.created_at limit 1
    on conflict do nothing;
  end if;
  return new;
end $$;
drop trigger if exists profiles_autolink on public.profiles;
create trigger profiles_autolink after insert on public.profiles for each row execute function public.autolink_profile();

create or replace function public.autolink_client() returns trigger language plpgsql security definer set search_path=public as $$
begin
  insert into public.client_users(client_id,user_id)
  select new.id,p.id from public.profiles p where p.role='client' and lower(p.email)=lower(new.email)
    and not exists(select 1 from public.client_users u where u.user_id=p.id)
  on conflict do nothing;
  return new;
end $$;
drop trigger if exists clients_autolink on public.clients;
create trigger clients_autolink after insert or update of email on public.clients for each row execute function public.autolink_client();

-- One-time backfill for users and clients that already exist.
insert into public.client_users(client_id,user_id)
select distinct on (p.id) c.id,p.id from public.profiles p join public.clients c on lower(c.email)=lower(p.email)
where p.role='client' and not exists(select 1 from public.client_users u where u.user_id=p.id)
order by p.id,c.created_at
on conflict do nothing;
