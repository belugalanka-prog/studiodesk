-- Run once in the Supabase SQL editor. Admin role assignment is intentionally manual.
create extension if not exists pgcrypto;
create type public.user_role as enum ('admin','client');
create type public.project_status as enum ('New Enquiry','Quotation Sent','Awaiting Confirmation','Confirmed','In Progress','Internal Review','Client Review','Revision Requested','Approved','Ready for Delivery','Completed','On Hold','Cancelled');
create type public.invoice_status as enum ('Paid','Partially Paid','Pending','Overdue','Void');
create type public.file_category as enum ('References','Original Photos','Raw Videos','Design Files','Previews','Edited Videos','Final Deliverables','Documents','Invoices','Receipts');

create table public.profiles(id uuid primary key references auth.users on delete cascade, role public.user_role not null default 'client', full_name text not null default '', email text not null default '', created_at timestamptz not null default now());
create function public.on_auth_user_created() returns trigger language plpgsql security definer set search_path=public as $$ begin insert into public.profiles(id,email,full_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name','')); return new; end $$;
create trigger auth_user_profile after insert on auth.users for each row execute function public.on_auth_user_created();
create function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from public.profiles where id=auth.uid() and role='admin') $$;

create table public.clients(id uuid primary key default gen_random_uuid(), name text not null, business_name text, phone text, email text not null, address text, social_links jsonb not null default '{}', notes text, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.client_users(client_id uuid not null references public.clients on delete cascade, user_id uuid not null unique references public.profiles on delete cascade, created_at timestamptz not null default now(), primary key(client_id,user_id));
create table public.services(id uuid primary key default gen_random_uuid(), name text not null, description text, unit_price numeric(12,2) not null default 0 check(unit_price>=0), active boolean not null default true, created_at timestamptz not null default now());
create table public.projects(id uuid primary key default gen_random_uuid(), project_code bigint generated always as identity unique, client_id uuid not null references public.clients, title text not null, category text not null default 'Other', description text, agreed_price numeric(12,2) not null default 0 check(agreed_price>=0), status public.project_status not null default 'New Enquiry', priority text not null default 'Normal' check(priority in ('Low','Normal','High','Urgent')), progress smallint not null default 0 check(progress between 0 and 100), start_date date, deadline date, assigned_staff text, archived_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
create table public.project_tasks(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, title text not null, description text, due_date date, completed boolean not null default false, assigned_to text, created_at timestamptz not null default now());
create table public.project_updates(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, author_id uuid not null references public.profiles, body text not null, update_type text not null default 'update', visible_to_client boolean not null default true, created_at timestamptz not null default now());
create table public.project_files(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, uploaded_by uuid not null references public.profiles, storage_path text not null unique, name text not null, category public.file_category not null default 'Documents', visible_to_client boolean not null default false, version integer not null default 1 check(version>0), mime_type text, size_bytes bigint, created_at timestamptz not null default now());
create table public.deliverables(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, file_id uuid references public.project_files on delete set null, approved_by uuid references public.profiles, approved_at timestamptz, feedback text, created_at timestamptz not null default now());
create table public.quotations(id uuid primary key default gen_random_uuid(), quote_number bigint generated always as identity unique, client_id uuid not null references public.clients, project_id uuid references public.projects, status text not null default 'Draft' check(status in ('Draft','Sent','Accepted','Declined','Expired')), subtotal numeric(12,2) not null default 0, discount numeric(12,2) not null default 0, tax_rate numeric(6,3) not null default 0, total numeric(12,2) not null default 0, valid_until date, notes text, created_at timestamptz not null default now());
create table public.quotation_items(id uuid primary key default gen_random_uuid(), quotation_id uuid not null references public.quotations on delete cascade, description text not null, quantity numeric(10,2) not null default 1 check(quantity>0), unit_price numeric(12,2) not null default 0 check(unit_price>=0));
create table public.invoices(id uuid primary key default gen_random_uuid(), invoice_number bigint generated always as identity unique, client_id uuid not null references public.clients, project_id uuid references public.projects, quotation_id uuid references public.quotations, status public.invoice_status not null default 'Pending', subtotal numeric(12,2) not null default 0, discount numeric(12,2) not null default 0, tax_rate numeric(6,3) not null default 0, total numeric(12,2) not null default 0, issue_date date not null default current_date, due_date date, payment_terms text, notes text, created_by uuid references public.profiles, created_at timestamptz not null default now());
create table public.invoice_items(id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices on delete cascade, description text not null, quantity numeric(10,2) not null default 1 check(quantity>0), unit_price numeric(12,2) not null default 0 check(unit_price>=0));
create table public.payments(id uuid primary key default gen_random_uuid(), invoice_id uuid not null references public.invoices on delete cascade, amount numeric(12,2) not null check(amount>0), method text not null default 'Bank transfer', reference text, verified boolean not null default false, recorded_by uuid references public.profiles, paid_at timestamptz not null default now(), created_at timestamptz not null default now());
create table public.messages(id uuid primary key default gen_random_uuid(), project_id uuid not null references public.projects on delete cascade, sender_id uuid not null references public.profiles, body text not null, attachment_path text, created_at timestamptz not null default now());
create table public.message_reads(message_id uuid not null references public.messages on delete cascade, user_id uuid not null references public.profiles on delete cascade, read_at timestamptz not null default now(), primary key(message_id,user_id));
create table public.notifications(id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade, title text not null, body text, link text, read_at timestamptz, created_at timestamptz not null default now());
create table public.activity_logs(id uuid primary key default gen_random_uuid(), actor_id uuid references public.profiles, client_id uuid references public.clients on delete set null, project_id uuid references public.projects on delete set null, action text not null, detail jsonb not null default '{}', created_at timestamptz not null default now());
create table public.business_settings(id boolean primary key default true check(id), business_name text not null default 'StudioDesk', currency text not null default 'LKR', tax_rate numeric(6,3) not null default 0, logo_path text, address text, phone text, email text, payment_terms text default 'Due within 14 days', updated_at timestamptz not null default now());
insert into public.business_settings(id) values(true) on conflict do nothing;

create index projects_client_idx on public.projects(client_id); create index projects_status_idx on public.projects(status); create index projects_deadline_idx on public.projects(deadline); create index invoices_client_idx on public.invoices(client_id); create index invoices_due_idx on public.invoices(due_date); create index payments_invoice_idx on public.payments(invoice_id); create index files_project_idx on public.project_files(project_id); create index messages_project_time_idx on public.messages(project_id,created_at); create index clients_email_idx on public.clients(lower(email));

-- Auto calculate invoice payment status after verified payment changes.
create function public.refresh_invoice_status() returns trigger language plpgsql security definer set search_path=public as $$ declare inv uuid; paid numeric; total_due numeric; begin inv=coalesce(new.invoice_id,old.invoice_id); select total into total_due from public.invoices where id=inv; select coalesce(sum(amount),0) into paid from public.payments where invoice_id=inv and verified; update public.invoices set status=case when paid>=total_due and total_due>0 then 'Paid'::public.invoice_status when paid>0 then 'Partially Paid'::public.invoice_status when due_date<current_date then 'Overdue'::public.invoice_status else 'Pending'::public.invoice_status end where id=inv and status<>'Void'; return coalesce(new,old); end $$;
create trigger payment_status_refresh after insert or update or delete on public.payments for each row execute function public.refresh_invoice_status();

alter table public.profiles enable row level security; alter table public.clients enable row level security; alter table public.client_users enable row level security; alter table public.services enable row level security; alter table public.projects enable row level security; alter table public.project_tasks enable row level security; alter table public.project_updates enable row level security; alter table public.project_files enable row level security; alter table public.deliverables enable row level security; alter table public.quotations enable row level security; alter table public.quotation_items enable row level security; alter table public.invoices enable row level security; alter table public.invoice_items enable row level security; alter table public.payments enable row level security; alter table public.messages enable row level security; alter table public.message_reads enable row level security; alter table public.notifications enable row level security; alter table public.activity_logs enable row level security; alter table public.business_settings enable row level security;

create policy "profile self or admin read" on public.profiles for select using(id=auth.uid() or public.is_admin());
create policy "profile self update" on public.profiles for update using(id=auth.uid()) with check(id=auth.uid());
create policy "admins manage clients" on public.clients for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads own client" on public.clients for select using(exists(select 1 from public.client_users cu where cu.client_id=id and cu.user_id=auth.uid()));
create policy "admin manages client links" on public.client_users for all using(public.is_admin()) with check(public.is_admin());
create policy "client sees own link" on public.client_users for select using(user_id=auth.uid());
create policy "admin manages services" on public.services for all using(public.is_admin()) with check(public.is_admin());
create policy "authenticated sees active services" on public.services for select to authenticated using(active);
create policy "admin manages projects" on public.projects for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads own projects" on public.projects for select using(exists(select 1 from public.client_users cu where cu.client_id=public.projects.client_id and cu.user_id=auth.uid()));
create policy "admin manages tasks" on public.project_tasks for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads own tasks" on public.project_tasks for select using(exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
create policy "admins manage updates" on public.project_updates for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads visible updates" on public.project_updates for select using(visible_to_client and exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
create policy "admins manage files" on public.project_files for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads permitted files" on public.project_files for select using(visible_to_client and exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
create policy "admin manages deliverables" on public.deliverables for all using(public.is_admin()) with check(public.is_admin());
create policy "client sees own deliverables" on public.deliverables for select using(exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
create policy "admins manage quotations" on public.quotations for all using(public.is_admin()) with check(public.is_admin());
create policy "clients read own quotations" on public.quotations for select using(exists(select 1 from public.client_users cu where cu.client_id=public.quotations.client_id and cu.user_id=auth.uid()));
create policy "admin manages quote lines" on public.quotation_items for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads own quote lines" on public.quotation_items for select using(exists(select 1 from public.quotations q join public.client_users cu on cu.client_id=q.client_id where q.id=quotation_id and cu.user_id=auth.uid()));
create policy "admin manages invoices" on public.invoices for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads own invoices" on public.invoices for select using(exists(select 1 from public.client_users cu where cu.client_id=public.invoices.client_id and cu.user_id=auth.uid()));
create policy "admin manages invoice lines" on public.invoice_items for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads own invoice lines" on public.invoice_items for select using(exists(select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=invoice_id and cu.user_id=auth.uid()));
create policy "admin manages payments" on public.payments for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads verified own payments" on public.payments for select using(verified and exists(select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=invoice_id and cu.user_id=auth.uid()));
create policy "admin manages messages" on public.messages for all using(public.is_admin()) with check(public.is_admin());
create policy "client reads own messages" on public.messages for select using(exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
create policy "client sends own messages" on public.messages for insert with check(sender_id=auth.uid() and exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));
create policy "users manage own reads" on public.message_reads for all using(user_id=auth.uid() or public.is_admin()) with check(user_id=auth.uid() or public.is_admin());
create policy "users read own notifications" on public.notifications for all using(user_id=auth.uid() or public.is_admin()) with check(user_id=auth.uid() or public.is_admin());
create policy "admin reads activity" on public.activity_logs for select using(public.is_admin()); create policy "authenticated logs activity" on public.activity_logs for insert to authenticated with check(actor_id=auth.uid());
create policy "admin manages business settings" on public.business_settings for all using(public.is_admin()) with check(public.is_admin());
create policy "authenticated reads business settings" on public.business_settings for select to authenticated using(true);

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('project-files','project-files',false,524288000,array['image/jpeg','image/png','image/webp','image/gif','video/mp4','video/quicktime','application/pdf','application/zip','application/octet-stream']) on conflict(id) do nothing;
create policy "admin manages project storage" on storage.objects for all to authenticated using(bucket_id='project-files' and public.is_admin()) with check(bucket_id='project-files' and public.is_admin());
create policy "client reads visible project storage" on storage.objects for select to authenticated using(bucket_id='project-files' and exists(select 1 from public.project_files f join public.projects p on p.id=f.project_id join public.client_users cu on cu.client_id=p.client_id where f.storage_path=name and f.visible_to_client and cu.user_id=auth.uid()));


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
create trigger profiles_role_guard before update on public.profiles for each row execute function public.prevent_role_change();

-- 2. Client file downloads: "name" was ambiguous (project_files.name vs storage.objects.name).
drop policy if exists "client reads visible project storage" on storage.objects;
create policy "client reads visible project storage" on storage.objects for select to authenticated using(
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
create policy "client reads own client" on public.clients for select using(exists(select 1 from public.client_users cu where cu.client_id=public.clients.id and cu.user_id=auth.uid()));
