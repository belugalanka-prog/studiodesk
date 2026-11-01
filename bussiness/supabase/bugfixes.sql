-- StudioDesk bug fixes. Run once in the Supabase SQL Editor (after the other SQL files). Safe to re-run.

-- 1. A client could edit their own profile e-mail. The auto-link triggers and the admin "Link account" lookup
--    match on that e-mail, so it could be used to get linked to someone else's client record.
--    Only admins may change a role or an e-mail now.
create or replace function public.prevent_role_change() returns trigger language plpgsql security definer set search_path=public as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    if new.role is distinct from old.role then raise exception 'Only an administrator can change a role'; end if;
    if new.email is distinct from old.email then raise exception 'Your sign-in e-mail cannot be changed here'; end if;
  end if;
  return new;
end $$;

-- 2. Admin messages could be inserted with someone else's sender_id.
drop policy if exists "admin manages messages" on public.messages;
create policy "admin manages messages" on public.messages for all
  using (public.is_admin()) with check (public.is_admin() and sender_id = auth.uid());
