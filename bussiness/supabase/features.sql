-- StudioDesk features: bank slips, expenses, calendar + reminders, revision tracking, admin MFA switch, sign-in alerts.
-- Safe to run more than once. Run AFTER schema.sql, fixes.sql, upgrade.sql and security.sql.

-- ===========================================================================
-- 5. Bank-transfer slips (client uploads, admin approves with one click)
-- ===========================================================================
create table if not exists public.payment_slips(
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices on delete cascade,
  storage_path text not null unique,
  amount numeric(12,2) not null check(amount>0),
  reference text, note text,
  status text not null default 'Pending' check(status in ('Pending','Approved','Rejected')),
  submitted_by uuid not null references public.profiles,
  reviewed_by uuid references public.profiles, reviewed_at timestamptz, review_note text,
  payment_id uuid references public.payments on delete set null,
  created_at timestamptz not null default now());
create index if not exists slips_invoice_idx on public.payment_slips(invoice_id);
alter table public.payment_slips enable row level security;

drop policy if exists "admin manages slips" on public.payment_slips;
create policy "admin manages slips" on public.payment_slips for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own slips" on public.payment_slips;
create policy "client reads own slips" on public.payment_slips for select using(exists(select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=invoice_id and cu.user_id=auth.uid()));
drop policy if exists "client submits own slip" on public.payment_slips;
create policy "client submits own slip" on public.payment_slips for insert with check(
  submitted_by=auth.uid() and status='Pending' and reviewed_by is null and payment_id is null
  and split_part(storage_path,'/',1)=invoice_id::text
  and exists(select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=invoice_id and cu.user_id=auth.uid() and i.status not in ('Void','Paid')));

-- at most 5 waiting slips per invoice (stops upload spam)
create or replace function public.limit_pending_slips() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if (select count(*) from public.payment_slips where invoice_id=new.invoice_id and status='Pending') >= 5 then raise exception 'Too many slips are waiting for review on this invoice'; end if;
  return new;
end $$;
drop trigger if exists slips_limit on public.payment_slips;
create trigger slips_limit before insert on public.payment_slips for each row execute function public.limit_pending_slips();

create or replace function public.notify_admins(p_title text, p_body text, p_link text) returns void language sql security definer set search_path=public as $$
  insert into public.notifications(user_id,title,body,link) select id,p_title,p_body,p_link from public.profiles where role='admin' $$;
revoke all on function public.notify_admins(text,text,text) from public, anon, authenticated;

create or replace function public.slip_uploaded() returns trigger language plpgsql security definer set search_path=public as $$
begin
  perform public.notify_admins('Payment slip uploaded', 'LKR '||new.amount||' – please verify', 'invoice-details.html?id='||new.invoice_id);
  return new;
end $$;
drop trigger if exists slips_notify on public.payment_slips;
create trigger slips_notify after insert on public.payment_slips for each row execute function public.slip_uploaded();

create or replace function public.review_slip(p_id uuid, p_approve boolean, p_note text default null, p_amount numeric default null)
returns public.payment_slips language plpgsql security definer set search_path=public as $$
declare s public.payment_slips; pay public.payments; inv public.invoices;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into s from public.payment_slips where id=p_id for update;
  if not found then raise exception 'Slip not found'; end if;
  if s.status<>'Pending' then raise exception 'This slip has already been reviewed'; end if;
  if p_approve then
    pay := public.record_payment(s.invoice_id, coalesce(p_amount, s.amount), 'Bank transfer', coalesce(s.reference, 'Slip '||left(s.id::text,8)), current_date);
    s.payment_id := pay.id;
  end if;
  update public.payment_slips set status=case when p_approve then 'Approved' else 'Rejected' end, reviewed_by=auth.uid(), reviewed_at=now(),
    review_note=nullif(btrim(p_note),''), payment_id=s.payment_id where id=p_id returning * into s;
  select * into inv from public.invoices where id=s.invoice_id;
  insert into public.notifications(user_id,title,body,link)
    select cu.user_id, case when p_approve then 'Payment confirmed' else 'Payment slip not accepted' end,
           coalesce(s.review_note, case when p_approve then 'Thank you – your payment was received.' else 'Please check the details and upload a new slip.' end),
           'client-invoice-details.html?id='||s.invoice_id
    from public.client_users cu where cu.client_id=inv.client_id;
  return s;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('payment-slips','payment-slips',false,5242880,array['image/jpeg','image/png','image/webp','application/pdf']) on conflict(id) do nothing;
drop policy if exists "slips admin storage" on storage.objects;
create policy "slips admin storage" on storage.objects for all to authenticated using(bucket_id='payment-slips' and public.is_admin()) with check(bucket_id='payment-slips' and public.is_admin());
drop policy if exists "slips client upload" on storage.objects;
create policy "slips client upload" on storage.objects for insert to authenticated with check(bucket_id='payment-slips' and exists(
  select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id::text=split_part(storage.objects.name,'/',1) and cu.user_id=auth.uid() and i.status not in ('Void','Paid')));
drop policy if exists "slips client read" on storage.objects;
create policy "slips client read" on storage.objects for select to authenticated using(bucket_id='payment-slips' and exists(
  select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id::text=split_part(storage.objects.name,'/',1) and cu.user_id=auth.uid()));

-- ===========================================================================
-- 6. Expenses (admin only)
-- ===========================================================================
create table if not exists public.expenses(
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default current_date,
  category text not null default 'Other' check(category in ('Equipment','Software','Freelancer','Travel','Marketing','Rent & utilities','Other')),
  description text not null check(length(btrim(description)) between 1 and 300),
  vendor text, amount numeric(12,2) not null check(amount>0),
  project_id uuid references public.projects on delete set null,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now());
create index if not exists expenses_date_idx on public.expenses(spent_on);
alter table public.expenses enable row level security;
drop policy if exists "admin manages expenses" on public.expenses;
create policy "admin manages expenses" on public.expenses for all using(public.is_admin()) with check(public.is_admin());

-- ===========================================================================
-- 7. Calendar events + daily reminders
-- ===========================================================================
create table if not exists public.calendar_events(
  id uuid primary key default gen_random_uuid(),
  title text not null check(length(btrim(title)) between 1 and 200),
  kind text not null default 'Shoot' check(kind in ('Shoot','Meeting','Delivery','Other')),
  starts_at timestamptz not null, ends_at timestamptz,
  location text, notes text,
  project_id uuid references public.projects on delete set null,
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now());
create index if not exists events_start_idx on public.calendar_events(starts_at);
alter table public.calendar_events enable row level security;
drop policy if exists "admin manages events" on public.calendar_events;
create policy "admin manages events" on public.calendar_events for all using(public.is_admin()) with check(public.is_admin());

-- Creates one in-app notification (e-mailed by the notify-admin webhook) per admin per item per day.
create or replace function public.send_deadline_reminders(p_days integer default 2) returns integer
language plpgsql security definer set search_path=public as $$
declare n integer := 0; r record; a record;
begin
  for a in select id from public.profiles where role='admin' loop
    for r in select id,title,deadline from public.projects
             where archived_at is null and status not in ('Completed','Cancelled','On Hold') and deadline between current_date and current_date + p_days loop
      insert into public.notifications(user_id,title,body,link)
        select a.id, 'Deadline: '||r.title, 'Due '||to_char(r.deadline,'DD Mon YYYY'), 'project-details.html?id='||r.id
        where not exists(select 1 from public.notifications x where x.user_id=a.id and x.link='project-details.html?id='||r.id and x.title like 'Deadline:%' and x.created_at::date=current_date);
      if found then n := n + 1; end if;
    end loop;
    for r in select id,title,starts_at,kind from public.calendar_events where starts_at between now() and now() + interval '36 hours' loop
      insert into public.notifications(user_id,title,body,link)
        select a.id, r.kind||' soon: '||r.title, to_char(r.starts_at at time zone 'Asia/Colombo','DD Mon HH24:MI'), 'calendar.html'
        where not exists(select 1 from public.notifications x where x.user_id=a.id and x.title=r.kind||' soon: '||r.title and x.created_at::date=current_date);
      if found then n := n + 1; end if;
    end loop;
  end loop;
  return n;
end $$;
revoke all on function public.send_deadline_reminders(integer) from public, anon, authenticated;

-- Schedule daily at 02:00 UTC (07:30 Sri Lanka) when pg_cron is available (Supabase: Database -> Extensions).
do $$ begin
  create extension if not exists pg_cron;
  perform cron.unschedule('studiodesk-reminders') where exists(select 1 from cron.job where jobname='studiodesk-reminders');
  perform cron.schedule('studiodesk-reminders','0 2 * * *','select public.send_deadline_reminders()');
exception when others then
  raise notice 'pg_cron not enabled - reminders are NOT scheduled (%). Enable the pg_cron extension and re-run this file.', sqlerrm;
end $$;

-- ===========================================================================
-- 8. Revision / approval tracking
-- ===========================================================================
alter table public.projects add column if not exists included_revisions integer not null default 2 check(included_revisions >= 0);

create table if not exists public.revision_requests(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  kind text not null check(kind in ('Changes requested','Approved')),
  round integer, comment text check(comment is null or length(comment) <= 2000),
  status text not null default 'Open' check(status in ('Open','Addressed')),
  created_by uuid references public.profiles default auth.uid(),
  created_at timestamptz not null default now(), addressed_at timestamptz);
create index if not exists revisions_project_idx on public.revision_requests(project_id, created_at);
alter table public.revision_requests enable row level security;
drop policy if exists "admin manages revisions" on public.revision_requests;
create policy "admin manages revisions" on public.revision_requests for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own revisions" on public.revision_requests;
create policy "client reads own revisions" on public.revision_requests for select using(exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=project_id and cu.user_id=auth.uid()));

create or replace function public.client_owns_project(p_project uuid) returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=p_project and cu.user_id=auth.uid()) $$;
revoke all on function public.client_owns_project(uuid) from public, anon;
grant execute on function public.client_owns_project(uuid) to authenticated;

create or replace function public.request_revision(p_project uuid, p_comment text) returns public.revision_requests
language plpgsql security definer set search_path=public as $$
declare pr public.projects; rr public.revision_requests; rnd integer; c text := btrim(coalesce(p_comment,''));
begin
  if not public.client_owns_project(p_project) then raise exception 'Project not found'; end if;
  if length(c) < 3 or length(c) > 2000 then raise exception 'Please describe the changes you need (3-2000 characters)'; end if;
  if not public.rate_limit_ok('rev:'||auth.uid(), 20, interval '1 hour') then raise exception 'Too many requests. Please try again later.'; end if;
  select * into pr from public.projects where id=p_project;
  if pr.status in ('New Enquiry','Quotation Sent','Awaiting Confirmation','Completed','Cancelled','On Hold') then raise exception 'Changes cannot be requested while the project is %', lower(pr.status); end if;
  select count(*)+1 into rnd from public.revision_requests where project_id=p_project and kind='Changes requested';
  insert into public.revision_requests(project_id,kind,round,comment) values(p_project,'Changes requested',rnd,c) returning * into rr;
  update public.projects set status='Revision Requested' where id=p_project;
  perform public.notify_admins('Changes requested: '||pr.title, 'Round '||rnd||' of '||pr.included_revisions||' included. '||left(c,120), 'project-details.html?id='||p_project);
  return rr;
end $$;

create or replace function public.approve_project(p_project uuid, p_comment text default null) returns public.revision_requests
language plpgsql security definer set search_path=public as $$
declare pr public.projects; rr public.revision_requests;
begin
  if not public.client_owns_project(p_project) then raise exception 'Project not found'; end if;
  select * into pr from public.projects where id=p_project;
  if pr.status not in ('Client Review','Ready for Delivery') then raise exception 'This project is not waiting for your approval'; end if;
  insert into public.revision_requests(project_id,kind,comment,status,addressed_at) values(p_project,'Approved',left(nullif(btrim(p_comment),''),2000),'Addressed',now()) returning * into rr;
  update public.projects set status='Approved' where id=p_project;
  perform public.notify_admins('Approved by client: '||pr.title, coalesce(left(p_comment,120),'No comment'), 'project-details.html?id='||p_project);
  return rr;
end $$;

create or replace function public.address_revision(p_id uuid) returns public.revision_requests
language plpgsql security definer set search_path=public as $$
declare rr public.revision_requests;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.revision_requests set status='Addressed', addressed_at=now() where id=p_id and status='Open' and kind='Changes requested' returning * into rr;
  if not found then raise exception 'Revision not found or already addressed'; end if;
  if not exists(select 1 from public.revision_requests where project_id=rr.project_id and kind='Changes requested' and status='Open') then
    update public.projects set status='Client Review' where id=rr.project_id and status='Revision Requested';
  end if;
  return rr;
end $$;

-- ===========================================================================
-- 12. Admin MFA switch + new sign-in alerts
-- ===========================================================================
alter table public.business_settings add column if not exists require_admin_mfa boolean not null default false;

-- When require_admin_mfa is on, admin powers need a session that passed the 2nd factor (aal2).
-- Lock-out recovery (SQL editor):  update public.business_settings set require_admin_mfa=false;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin')
     and (not coalesce((select require_admin_mfa from public.business_settings where id), false)
          or coalesce(auth.jwt()->>'aal','aal1')='aal2') $$;

create table if not exists public.login_events(
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles on delete cascade,
  ip text, device_hash text, device text, created_at timestamptz not null default now());
create index if not exists login_events_user_idx on public.login_events(user_id, created_at desc);
alter table public.login_events enable row level security;
drop policy if exists "users read own logins" on public.login_events;
create policy "users read own logins" on public.login_events for select using(user_id=auth.uid());

-- Called by the app right after a successful sign-in. Alerts the user when the IP + browser combination is new.
create or replace function public.record_login() returns void language plpgsql security definer set search_path=public as $$
declare h json := coalesce(nullif(current_setting('request.headers', true),'')::json, '{}'::json);
        v_ip text := coalesce(nullif(btrim(split_part(coalesce(h->>'x-forwarded-for',''), ',', 1)),''), 'unknown');
        v_ua text := left(coalesce(h->>'user-agent','unknown'), 200); v_hash text; v_seen boolean; v_first boolean;
begin
  if auth.uid() is null then return; end if;
  v_hash := md5(v_ip||'|'||v_ua);
  select exists(select 1 from public.login_events where user_id=auth.uid()) into v_first; v_first := not v_first;
  select exists(select 1 from public.login_events where user_id=auth.uid() and device_hash=v_hash) into v_seen;
  insert into public.login_events(user_id,ip,device_hash,device) values(auth.uid(),v_ip,v_hash,v_ua);
  delete from public.login_events where user_id=auth.uid() and created_at < now() - interval '90 days';
  if not v_first and not v_seen then
    insert into public.notifications(user_id,title,body,link)
      values(auth.uid(),'New sign-in to your account','From IP '||v_ip||' using '||left(v_ua,80)||'. If this was not you, change your password now.',null);
  end if;
end $$;

-- ===========================================================================
-- Audit trail for the new tables + least-privilege grants
-- ===========================================================================
do $$ declare t text; begin
  foreach t in array array['payment_slips','expenses','calendar_events','revision_requests'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

revoke all on public.payment_slips, public.expenses, public.calendar_events, public.revision_requests, public.login_events from anon;
revoke update, delete on public.login_events from authenticated;
revoke execute on function public.review_slip(uuid,boolean,text,numeric), public.request_revision(uuid,text), public.approve_project(uuid,text), public.address_revision(uuid), public.record_login() from public, anon;
grant execute on function public.review_slip(uuid,boolean,text,numeric), public.request_revision(uuid,text), public.approve_project(uuid,text), public.address_revision(uuid), public.record_login() to authenticated;
