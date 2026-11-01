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
