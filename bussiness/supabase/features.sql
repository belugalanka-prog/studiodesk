-- StudioDesk v4 features. Safe to run more than once.
-- Run AFTER schema.sql / fixes.sql / upgrade.sql / security.sql, in Supabase -> SQL Editor.
--
--  1. Payment slips (client uploads a transfer receipt, admin confirms with one click) + optional online payment link
--  2. Expenses (for a real monthly profit figure)
--  3. Calendar events (shoots, meetings) + deadline reminders
--  4. Revision / approval tracking
--  5. Admin MFA enforcement switch + sign-in history with new-device alerts

-- ---------------------------------------------------------------------------
-- 0. Columns, helpers
-- ---------------------------------------------------------------------------
alter table public.business_settings add column if not exists payment_link text;
alter table public.business_settings add column if not exists enforce_admin_mfa boolean not null default false;
alter table public.projects add column if not exists included_revisions smallint not null default 2 check (included_revisions between 0 and 50);
alter table public.notifications add column if not exists dedupe_key text;
create unique index if not exists notifications_dedupe_idx on public.notifications(user_id, dedupe_key) where dedupe_key is not null;
create index if not exists notifications_user_idx on public.notifications(user_id, created_at desc);

-- Insert a notification for every admin (optionally de-duplicated). Internal helper: not callable from the browser.
create or replace function public.notify_admins(p_title text, p_body text, p_link text, p_key text default null) returns void
language plpgsql security definer set search_path=public as $$
begin
  insert into public.notifications(user_id, title, body, link, dedupe_key)
    select id, p_title, p_body, p_link, p_key from public.profiles where role='admin'
  on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing;
end $$;
revoke all on function public.notify_admins(text,text,text,text) from public, anon, authenticated;

-- Admin MFA: when business_settings.enforce_admin_mfa is on, admin rights need a session that passed the MFA challenge (aal2).
-- Enrol your own authenticator first (mfa.html); switch it on under Settings. To undo from the SQL editor:
--   update public.business_settings set enforce_admin_mfa=false;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin')
     and (not coalesce((select enforce_admin_mfa from public.business_settings where id), false)
          or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2') $$;

-- ---------------------------------------------------------------------------
-- 1. Payment slips
-- ---------------------------------------------------------------------------
create table if not exists public.payment_slips(
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references public.invoices on delete cascade,
  uploaded_by uuid not null references public.profiles,
  storage_path text not null unique,
  file_name text not null,
  amount numeric(12,2) not null check(amount>0),
  reference text,
  paid_on date,
  status text not null default 'Pending' check(status in ('Pending','Confirmed','Rejected')),
  reviewer_note text,
  payment_id uuid references public.payments on delete set null,
  reviewed_by uuid references public.profiles,
  reviewed_at timestamptz,
  created_at timestamptz not null default now());
create index if not exists payment_slips_invoice_idx on public.payment_slips(invoice_id);
create index if not exists payment_slips_status_idx on public.payment_slips(status);
alter table public.payment_slips enable row level security;
drop policy if exists "admin manages slips" on public.payment_slips;
create policy "admin manages slips" on public.payment_slips for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own slips" on public.payment_slips;
create policy "client reads own slips" on public.payment_slips for select using(exists(select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=payment_slips.invoice_id and cu.user_id=auth.uid()));
-- clients never insert directly: they go through submit_payment_slip()

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
  values('payment-slips','payment-slips',false,10485760,array['image/jpeg','image/png','image/webp','image/heic','application/pdf'])
  on conflict(id) do update set file_size_limit=excluded.file_size_limit, allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists "admin manages slip storage" on storage.objects;
create policy "admin manages slip storage" on storage.objects for all to authenticated using(bucket_id='payment-slips' and public.is_admin()) with check(bucket_id='payment-slips' and public.is_admin());
-- a client may upload only into  <their client id>/<one of their invoice ids>/...
drop policy if exists "client uploads slips" on storage.objects;
create policy "client uploads slips" on storage.objects for insert to authenticated with check(
  bucket_id='payment-slips' and exists(
    select 1 from public.invoices i join public.client_users cu on cu.client_id=i.client_id
    where cu.user_id=auth.uid()
      and i.client_id::text=(string_to_array(storage.objects.name,'/'))[1]
      and i.id::text=(string_to_array(storage.objects.name,'/'))[2]));
drop policy if exists "client reads own slip files" on storage.objects;
create policy "client reads own slip files" on storage.objects for select to authenticated using(
  bucket_id='payment-slips' and exists(
    select 1 from public.payment_slips s join public.invoices i on i.id=s.invoice_id join public.client_users cu on cu.client_id=i.client_id
    where s.storage_path=storage.objects.name and cu.user_id=auth.uid()));

drop policy if exists "client removes unsubmitted slip" on storage.objects;
create policy "client removes unsubmitted slip" on storage.objects for delete to authenticated using(
  bucket_id='payment-slips' and owner=auth.uid()
  and not exists(select 1 from public.payment_slips s where s.storage_path=storage.objects.name));

create or replace function public.submit_payment_slip(p_invoice uuid, p_path text, p_name text, p_amount numeric, p_reference text, p_paid_on date)
returns public.payment_slips language plpgsql security definer set search_path=public as $$
declare inv public.invoices; paid numeric; s public.payment_slips; cname text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  select * into inv from public.invoices where id=p_invoice;
  if not found or not exists(select 1 from public.client_users where client_id=inv.client_id and user_id=auth.uid()) then raise exception 'Invoice not found'; end if;
  if inv.status in ('Void','Paid') then raise exception 'This invoice does not need a payment'; end if;
  if p_amount is null or p_amount<=0 then raise exception 'Enter the amount you transferred'; end if;
  select coalesce(sum(amount),0) into paid from public.payments where invoice_id=p_invoice and verified;
  if p_amount > inv.total-paid+0.005 then raise exception 'That is more than the balance due (%)', inv.total-paid; end if;
  if p_path is null or p_path not like inv.client_id::text||'/'||inv.id::text||'/%' then raise exception 'Invalid file'; end if;
  if not exists(select 1 from storage.objects where bucket_id='payment-slips' and name=p_path) then raise exception 'The upload did not complete. Please try again.'; end if;
  if (select count(*) from public.payment_slips where invoice_id=p_invoice and status='Pending') >= 5 then raise exception 'Several slips are already waiting for review on this invoice.'; end if;
  if not public.rate_limit_ok('slip:'||auth.uid(), 20, interval '1 day') then raise exception 'Too many uploads today. Please try again tomorrow.'; end if;
  insert into public.payment_slips(invoice_id, uploaded_by, storage_path, file_name, amount, reference, paid_on)
    values(p_invoice, auth.uid(), p_path, left(coalesce(nullif(btrim(p_name),''),'slip'),200), p_amount, left(nullif(btrim(p_reference),''),120), p_paid_on)
    returning * into s;
  select name into cname from public.clients where id=inv.client_id;
  perform public.notify_admins('Payment slip uploaded',
    coalesce(cname,'A client')||' uploaded a slip for INV-'||lpad(inv.invoice_number::text,4,'0')||' ('||p_amount||').',
    'invoice-details.html?id='||inv.id);
  return s;
end $$;

-- One click: records a verified payment from the slip (re-using record_payment's checks) and tells the client.
create or replace function public.confirm_payment_slip(p_slip uuid, p_amount numeric default null) returns public.payment_slips
language plpgsql security definer set search_path=public as $$
declare s public.payment_slips; pay public.payments;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  select * into s from public.payment_slips where id=p_slip for update;
  if not found then raise exception 'Slip not found'; end if;
  if s.status<>'Pending' then raise exception 'This slip was already %', lower(s.status); end if;
  pay := public.record_payment(s.invoice_id, coalesce(p_amount, s.amount), 'Bank transfer', coalesce(s.reference, 'Slip '||left(s.id::text,8)), s.paid_on);
  update public.payment_slips set status='Confirmed', payment_id=pay.id, reviewed_by=auth.uid(), reviewed_at=now() where id=p_slip returning * into s;
  insert into public.notifications(user_id, title, body, link)
    select cu.user_id, 'Payment confirmed', 'We received your payment of '||pay.amount||'. Thank you!', 'client-invoice-details.html?id='||s.invoice_id
    from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=s.invoice_id;
  return s;
end $$;

create or replace function public.reject_payment_slip(p_slip uuid, p_note text) returns public.payment_slips
language plpgsql security definer set search_path=public as $$
declare s public.payment_slips;
begin
  if not public.is_admin() then raise exception 'Administrator access required'; end if;
  update public.payment_slips set status='Rejected', reviewer_note=left(nullif(btrim(p_note),''),500), reviewed_by=auth.uid(), reviewed_at=now()
    where id=p_slip and status='Pending' returning * into s;
  if not found then raise exception 'This slip is not waiting for review'; end if;
  insert into public.notifications(user_id, title, body, link)
    select cu.user_id, 'Payment slip not accepted', coalesce(s.reviewer_note,'Please check the details and upload a clearer slip.'), 'client-invoice-details.html?id='||s.invoice_id
    from public.invoices i join public.client_users cu on cu.client_id=i.client_id where i.id=s.invoice_id;
  return s;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Expenses
-- ---------------------------------------------------------------------------
create table if not exists public.expenses(
  id uuid primary key default gen_random_uuid(),
  spent_on date not null default current_date,
  category text not null default 'Other' check(category in ('Equipment','Freelancers','Software','Travel','Marketing','Rent & utilities','Other')),
  vendor text,
  description text,
  amount numeric(12,2) not null check(amount>0),
  project_id uuid references public.projects on delete set null,
  created_by uuid references public.profiles,
  created_at timestamptz not null default now());
create index if not exists expenses_spent_idx on public.expenses(spent_on);
alter table public.expenses enable row level security;
drop policy if exists "admin manages expenses" on public.expenses;
create policy "admin manages expenses" on public.expenses for all using(public.is_admin()) with check(public.is_admin());

-- ---------------------------------------------------------------------------
-- 3. Calendar events + reminders
-- ---------------------------------------------------------------------------
create table if not exists public.events(
  id uuid primary key default gen_random_uuid(),
  title text not null,
  kind text not null default 'Shoot' check(kind in ('Shoot','Meeting','Delivery','Other')),
  starts_on date not null,
  start_time time,
  location text,
  notes text,
  project_id uuid references public.projects on delete set null,
  created_by uuid references public.profiles,
  created_at timestamptz not null default now());
create index if not exists events_starts_idx on public.events(starts_on);
alter table public.events enable row level security;
drop policy if exists "admin manages events" on public.events;
create policy "admin manages events" on public.events for all using(public.is_admin()) with check(public.is_admin());

-- Creates in-app reminders (the notify-admin webhook e-mails them) for things due in the next 3 days.
-- Each item reminds at most 3 times (3 days out, 1 day out, once overdue). Safe to call as often as you like.
-- The app calls it when an admin opens it; you can also schedule it:  select cron.schedule('studiodesk-reminders','0 3 * * *','select public.generate_reminders()');
create or replace function public.generate_reminders() returns integer language plpgsql security definer set search_path=public as $$
declare n integer;
begin
  if auth.uid() is not null and not public.is_admin() then return 0; end if;
  with items as (
    select 'project'::text k, p.id, p.title label, p.deadline due, 'project-details.html?id='||p.id link, 'Deadline'::text what
      from public.projects p where p.archived_at is null and p.status not in ('Completed','Cancelled') and p.deadline is not null
    union all
    select 'task', t.id, t.title||' ('||pr.title||')', t.due_date, 'project-details.html?id='||t.project_id, 'Task due'
      from public.project_tasks t join public.projects pr on pr.id=t.project_id
      where not t.completed and t.due_date is not null and pr.status not in ('Completed','Cancelled')
    union all
    select 'event', e.id, e.title, e.starts_on, 'calendar.html', e.kind from public.events e
    union all
    select 'invoice', i.id, 'INV-'||lpad(i.invoice_number::text,4,'0'), i.due_date, 'invoice-details.html?id='||i.id, 'Invoice due'
      from public.invoices i where i.status in ('Pending','Partially Paid','Overdue') and i.due_date is not null
  ), w as (
    select *, (due - current_date) d,
           case when due < current_date then 'late' when due - current_date <= 1 then 'd1' else 'd3' end tier
    from items
    where due between current_date - 14 and current_date + 3 and not (k='event' and due < current_date)
  ), ins as (
    insert into public.notifications(user_id, title, body, link, dedupe_key)
      select a.id,
             w.what || case when w.d < 0 then ' passed' when w.d = 0 then ' today' when w.d = 1 then ' tomorrow' else ' in '||w.d||' days' end,
             w.label || ' · ' || to_char(w.due,'DD Mon YYYY'), w.link,
             w.k||':'||w.id||':'||w.due||':'||w.tier
      from w cross join (select id from public.profiles where role='admin') a
    on conflict (user_id, dedupe_key) where dedupe_key is not null do nothing
    returning 1)
  select count(*) into n from ins;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. Revision / approval tracking
-- ---------------------------------------------------------------------------
create table if not exists public.deliverable_reviews(
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects on delete cascade,
  file_id uuid references public.project_files on delete set null,
  file_name text,
  round integer not null default 0,
  decision text not null check(decision in ('Approved','Changes requested')),
  comment text,
  author_id uuid references public.profiles,
  created_at timestamptz not null default now());
create index if not exists reviews_project_idx on public.deliverable_reviews(project_id, created_at);
alter table public.deliverable_reviews enable row level security;
drop policy if exists "admin manages reviews" on public.deliverable_reviews;
create policy "admin manages reviews" on public.deliverable_reviews for all using(public.is_admin()) with check(public.is_admin());
drop policy if exists "client reads own reviews" on public.deliverable_reviews;
create policy "client reads own reviews" on public.deliverable_reviews for select using(exists(select 1 from public.projects p join public.client_users cu on cu.client_id=p.client_id where p.id=deliverable_reviews.project_id and cu.user_id=auth.uid()));

-- "round" = how many change requests the project has used including this one (approvals carry the current count).
create or replace function public.submit_review(p_file uuid, p_decision text, p_comment text) returns public.deliverable_reviews
language plpgsql security definer set search_path=public as $$
declare f public.project_files; p public.projects; r public.deliverable_reviews; used integer; who text;
begin
  if auth.uid() is null then raise exception 'Sign in first'; end if;
  if p_decision not in ('Approved','Changes requested') then raise exception 'Invalid decision'; end if;
  p_comment := nullif(btrim(coalesce(p_comment,'')),'');
  if p_decision='Changes requested' and p_comment is null then raise exception 'Please describe the changes you would like'; end if;
  if length(coalesce(p_comment,'')) > 2000 then raise exception 'Comment is too long (2000 characters maximum)'; end if;
  select * into f from public.project_files where id=p_file;
  if not found or not f.visible_to_client then raise exception 'File not found'; end if;
  select * into p from public.projects where id=f.project_id;
  if not exists(select 1 from public.client_users where client_id=p.client_id and user_id=auth.uid()) then raise exception 'File not found'; end if;
  if not public.rate_limit_ok('review:'||auth.uid(), 60, interval '1 hour') then raise exception 'Too many requests. Please try again later.'; end if;
  select count(*) into used from public.deliverable_reviews where project_id=p.id and decision='Changes requested';
  if p_decision='Changes requested' then used := used + 1; end if;
  insert into public.deliverable_reviews(project_id, file_id, file_name, round, decision, comment, author_id)
    values(p.id, f.id, f.name, used, p_decision, p_comment, auth.uid()) returning * into r;
  if p_decision='Changes requested' then
    update public.projects set status='Revision Requested' where id=p.id and status in ('In Progress','Internal Review','Client Review','Approved','Ready for Delivery');
  else
    update public.projects set status='Approved' where id=p.id and status in ('Client Review','Revision Requested')
      and not exists(select 1 from public.project_files pf where pf.project_id=p.id and pf.visible_to_client
            and (select dr.decision from public.deliverable_reviews dr where dr.file_id=pf.id order by dr.created_at desc, dr.id limit 1)='Changes requested');
  end if;
  select name into who from public.clients where id=p.client_id;
  perform public.notify_admins(case when p_decision='Approved' then 'Deliverable approved' else 'Changes requested' end,
    coalesce(who,'Client')||' on "'||p.title||'" · '||f.name||coalesce(' · '||left(p_comment,140),''), 'project-details.html?id='||p.id);
  return r;
end $$;

-- ---------------------------------------------------------------------------
-- 5. Sign-in history + new-device alerts
-- ---------------------------------------------------------------------------
create table if not exists public.login_events(
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles on delete cascade,
  device_id text not null,
  ip text,
  user_agent text,
  new_device boolean not null default false,
  new_ip boolean not null default false,
  created_at timestamptz not null default now());
create index if not exists login_events_user_idx on public.login_events(user_id, created_at desc);
alter table public.login_events enable row level security;
drop policy if exists "admin reads sign-ins" on public.login_events;
create policy "admin reads sign-ins" on public.login_events for select using(public.is_admin());
revoke insert, update, delete on public.login_events from anon, authenticated;

-- Called by the app right after a successful password sign-in. A device id the account has never used before
-- raises a notification (and, through the notify-admin webhook, an e-mail) for every admin.
create or replace function public.record_login(p_device text) returns jsonb language plpgsql security definer set search_path=public as $$
declare uid uuid := auth.uid(); hdr json; v_ip text; v_ua text; v_role public.user_role; v_name text; v_first boolean; v_newdev boolean; v_newip boolean;
begin
  if uid is null then raise exception 'Sign in first'; end if;
  p_device := left(regexp_replace(coalesce(p_device,''), '[^A-Za-z0-9-]', '', 'g'), 64);
  if p_device = '' then p_device := 'unknown'; end if;
  if not public.rate_limit_ok('login-evt:'||uid, 30, interval '1 hour') then return jsonb_build_object('unusual', false); end if;
  begin hdr := current_setting('request.headers', true)::json; exception when others then hdr := null; end;
  v_ip := nullif(btrim(split_part(coalesce(hdr->>'x-forwarded-for',''), ',', 1)), '');
  v_ua := left(coalesce(hdr->>'user-agent',''), 300);
  select role, full_name into v_role, v_name from public.profiles where id=uid;
  select not exists(select 1 from public.login_events where user_id=uid) into v_first;
  select not exists(select 1 from public.login_events where user_id=uid and device_id=p_device) into v_newdev;
  select v_ip is not null and not exists(select 1 from public.login_events where user_id=uid and ip=v_ip) into v_newip;
  insert into public.login_events(user_id, device_id, ip, user_agent, new_device, new_ip) values(uid, p_device, v_ip, v_ua, v_newdev and not v_first, v_newip and not v_first);
  delete from public.login_events where created_at < now() - interval '180 days';
  if v_role='admin' and not v_first and v_newdev then
    perform public.notify_admins('Admin sign-in from a new device',
      coalesce(nullif(v_name,''),'An admin')||' signed in from a device not seen before (IP '||coalesce(v_ip,'unknown')||'). If this was not you, change the password and review Audit log → Sign-ins.',
      'audit.html?tab=signins');
  end if;
  return jsonb_build_object('unusual', v_role='admin' and not v_first and v_newdev);
end $$;

-- ---------------------------------------------------------------------------
-- Audit trail for the new tables, grants
-- ---------------------------------------------------------------------------
do $$ declare t text; begin
  foreach t in array array['expenses','events','payment_slips','deliverable_reviews'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

revoke all on public.payment_slips, public.expenses, public.events, public.deliverable_reviews, public.login_events from anon;
revoke execute on function public.submit_payment_slip(uuid,text,text,numeric,text,date), public.confirm_payment_slip(uuid,numeric), public.reject_payment_slip(uuid,text),
  public.generate_reminders(), public.submit_review(uuid,text,text), public.record_login(text) from public, anon;
grant execute on function public.submit_payment_slip(uuid,text,text,numeric,text,date), public.confirm_payment_slip(uuid,numeric), public.reject_payment_slip(uuid,text),
  public.generate_reminders(), public.submit_review(uuid,text,text), public.record_login(text) to authenticated;
