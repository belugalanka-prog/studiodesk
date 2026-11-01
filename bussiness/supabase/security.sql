-- StudioDesk security + automation. Safe to run more than once.
-- Run AFTER schema.sql / fixes.sql / upgrade.sql, in Supabase -> SQL Editor.
--
--  1. Website enquiry -> client record (public, validated, rate limited, no data leaked)
--  2. Database audit trail (every insert / update / delete on business tables -> activity_logs)
--  3. Hardening: profile email lock, tamper-proof activity log, rate-limit table kept private

-- ---------------------------------------------------------------------------
-- 0. Housekeeping
-- ---------------------------------------------------------------------------
-- One client per e-mail address (case-insensitive). Skipped with a notice if duplicates already exist.
do $$ begin
  create unique index if not exists clients_email_unique on public.clients(lower(email));
exception when unique_violation then
  raise notice 'clients_email_unique NOT created: duplicate client e-mails exist. Merge them, then re-run this file.';
end $$;

create table if not exists public.rate_limits(
  bucket text not null, window_start timestamptz not null, hits integer not null default 1,
  primary key(bucket, window_start));
alter table public.rate_limits enable row level security;   -- no policies: only SECURITY DEFINER functions touch it
revoke all on public.rate_limits from anon, authenticated;

-- returns true when the caller is still inside the allowance for this bucket/window
create or replace function public.rate_limit_ok(p_bucket text, p_max integer, p_window interval) returns boolean
language plpgsql security definer set search_path=public as $$
declare w timestamptz := to_timestamp(floor(extract(epoch from now()) / extract(epoch from p_window)) * extract(epoch from p_window)); n integer;
begin
  delete from public.rate_limits where window_start < now() - interval '2 days';
  insert into public.rate_limits(bucket, window_start, hits) values (p_bucket, w, 1)
    on conflict (bucket, window_start) do update set hits = public.rate_limits.hits + 1
    returning hits into n;
  return n <= p_max;
end $$;
revoke all on function public.rate_limit_ok(text,integer,interval) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. Website enquiry -> new client
-- ---------------------------------------------------------------------------
-- The site calls this with the public (anon) key. It never reveals whether an e-mail
-- already exists: the response is always {"ok":true} unless the input is invalid or rate-limited.
create or replace function public.submit_enquiry(p_name text, p_email text, p_phone text default null, p_message text default null, p_website text default null)
returns jsonb language plpgsql security definer set search_path=public as $$
declare
  v_email text := lower(btrim(coalesce(p_email,'')));
  v_name  text := btrim(regexp_replace(coalesce(p_name,''), '[[:cntrl:]]', ' ', 'g'));
  v_phone text := nullif(btrim(regexp_replace(coalesce(p_phone,''), '[^0-9+()\-. ]', '', 'g')), '');
  v_msg   text := nullif(btrim(regexp_replace(coalesce(p_message,''), '[\x00-\x08\x0B\x0C\x0E-\x1F]', '', 'g')), '');
  v_ip    text := coalesce(nullif(btrim(split_part(coalesce(current_setting('request.headers', true)::json->>'x-forwarded-for',''), ',', 1)), ''), 'unknown');
  v_client public.clients; v_new boolean := false; v_admin record;
begin
  -- honeypot: real people never fill the hidden "website" field. Pretend success, store nothing.
  if coalesce(btrim(p_website),'') <> '' then return jsonb_build_object('ok', true); end if;

  if v_email !~ '^[a-z0-9._%+\-]+@[a-z0-9\-]+(\.[a-z0-9\-]+)*\.[a-z]{2,}$' or length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'error', 'Please enter a valid email address.'); end if;
  if length(v_name) < 2 or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'error', 'Please enter your name (2-120 characters).'); end if;
  if length(coalesce(v_msg,'')) > 2000 then
    return jsonb_build_object('ok', false, 'error', 'Your message is too long (2000 characters maximum).'); end if;

  if not public.rate_limit_ok('enq-ip:'||v_ip, 5, interval '1 hour')
     or not public.rate_limit_ok('enq-mail:'||v_email, 3, interval '1 hour')
     or not public.rate_limit_ok('enq-all', 300, interval '1 hour') then
    return jsonb_build_object('ok', false, 'error', 'Too many requests. Please try again later.'); end if;

  perform pg_advisory_xact_lock(hashtext('enquiry:'||v_email));   -- two simultaneous submissions can't create two clients
  select * into v_client from public.clients where lower(email) = v_email;
  if not found then
    insert into public.clients(name, email, phone, notes)
      values (v_name, v_email, left(v_phone, 40), case when v_msg is not null then 'Website enquiry: '||v_msg end)
      returning * into v_client;
    v_new := true;
  end if;

  -- every enquiry becomes a lead in the pipeline
  insert into public.projects(client_id, title, description, status)
    values (v_client.id, 'Website enquiry – '||to_char(now() at time zone 'Asia/Colombo','YYYY-MM-DD'), v_msg, 'New Enquiry');

  insert into public.activity_logs(client_id, action, detail)
    values (v_client.id, case when v_new then 'Website enquiry: new client created' else 'Website enquiry: existing client' end,
            jsonb_build_object('source','website','email',v_email,'name',v_name,'message',left(v_msg,500)));

  for v_admin in select id from public.profiles where role = 'admin' loop
    insert into public.notifications(user_id, title, body, link)
      values (v_admin.id, case when v_new then 'New client from website' else 'Enquiry from existing client' end,
              v_name||' <'||v_email||'>'||coalesce(' – '||left(v_msg,140),''), 'client-details.html?id='||v_client.id);
  end loop;
  return jsonb_build_object('ok', true);
end $$;
revoke all on function public.submit_enquiry(text,text,text,text,text) from public;
grant execute on function public.submit_enquiry(text,text,text,text,text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Audit trail: record what happens in the database
-- ---------------------------------------------------------------------------
create or replace function public.audit_row() returns trigger language plpgsql security definer set search_path=public as $$
declare
  r jsonb := to_jsonb(case when tg_op='DELETE' then old else new end);
  o jsonb := case when tg_op='INSERT' then '{}'::jsonb else to_jsonb(old) end;
  watched text[] := array['status','progress','archived_at','total','amount','completed','verified','role','active','visible_to_client'];
  changed jsonb := '{}'::jsonb; k text; v_client uuid; v_project uuid;
begin
  if tg_op = 'UPDATE' then
    for k in select key from jsonb_each(r) loop
      if k not in ('updated_at') and r->k is distinct from o->k then
        changed := changed || jsonb_build_object(k, case when k = any(watched) then jsonb_build_object('from', o->k, 'to', r->k) else to_jsonb('changed'::text) end);
      end if;
    end loop;
    if changed = '{}'::jsonb then return new; end if;               -- nothing meaningful changed
  end if;
  -- on delete the parent row may be gone (FK), so keep ids in "detail" only
  if tg_op <> 'DELETE' then
    v_client  := nullif(r->>'client_id','')::uuid;
    v_project := nullif(r->>'project_id','')::uuid;
    if tg_table_name = 'clients'  then v_client  := (r->>'id')::uuid; end if;
    if tg_table_name = 'projects' then v_project := (r->>'id')::uuid; end if;
  end if;
  insert into public.activity_logs(actor_id, client_id, project_id, action, detail)
    values (auth.uid(), v_client, v_project, 'db.'||tg_table_name||'.'||lower(tg_op),
            jsonb_build_object('id', r->>'id', 'table', tg_table_name, 'op', tg_op)
              || case when tg_op='UPDATE' then jsonb_build_object('changed', changed) else '{}'::jsonb end
              || case when tg_table_name in ('clients','projects','services') then jsonb_build_object('label', coalesce(r->>'name', r->>'title')) else '{}'::jsonb end);
  return case when tg_op='DELETE' then old else new end;
end $$;

do $$ declare t text; begin
  foreach t in array array['clients','client_users','projects','project_tasks','project_files','quotations','invoices','payments','services','business_settings','deliverables'] loop
    execute format('drop trigger if exists audit_%1$s on public.%1$s', t);
    execute format('create trigger audit_%1$s after insert or update or delete on public.%1$s for each row execute function public.audit_row()', t);
  end loop;
end $$;

create index if not exists activity_client_idx on public.activity_logs(client_id, created_at desc);
create index if not exists activity_created_idx on public.activity_logs(created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Hardening
-- ---------------------------------------------------------------------------
-- 3a. A user may not change their own role OR e-mail on their profile (admin linking is by e-mail).
create or replace function public.prevent_role_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role  is distinct from old.role  then raise exception 'Only an administrator can change a role'; end if;
    if new.email is distinct from old.email then raise exception 'E-mail can only be changed through account settings'; end if;
  end if;
  return new;
end $$;
drop trigger if exists profiles_role_guard on public.profiles;
create trigger profiles_role_guard before update on public.profiles for each row execute function public.prevent_role_change();

-- 3b. The log is append-only and only the admin (or a trigger) may write to it: no forged entries from clients.
drop policy if exists "authenticated logs activity" on public.activity_logs;
drop policy if exists "admin logs activity" on public.activity_logs;
create policy "admin logs activity" on public.activity_logs for insert to authenticated with check(actor_id=auth.uid() and public.is_admin());
revoke update, delete, truncate on public.activity_logs from anon, authenticated;

-- 3c. Anonymous visitors get no table access at all; the enquiry function is their only door.
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke execute on all functions in schema public from anon;
grant execute on function public.submit_enquiry(text,text,text,text,text) to anon;
