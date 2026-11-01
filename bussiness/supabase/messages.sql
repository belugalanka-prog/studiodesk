-- Messages fixes. Run once in the Supabase SQL Editor (after schema.sql / features.sql). Safe to re-run.

-- 1. No blank or oversized messages (existing rows are not re-checked).
alter table public.messages drop constraint if exists messages_body_ok;
alter table public.messages add constraint messages_body_ok
  check (length(btrim(body)) between 1 and 4000) not valid;

-- 2. Notify the other side when a message is sent (shows in the 🔔 bell).
create or replace function public.notify_new_message() returns trigger
language plpgsql security definer set search_path=public as $$
declare v_title text; v_client uuid; v_is_admin boolean;
begin
  select p.title, p.client_id into v_title, v_client from public.projects p where p.id = new.project_id;
  select (role = 'admin') into v_is_admin from public.profiles where id = new.sender_id;
  if coalesce(v_is_admin, false) then
    insert into public.notifications(user_id, title, body, link)
      select cu.user_id, 'New message from your studio', coalesce(v_title,'Project') || ': ' || left(new.body, 140),
             'client-project-details.html?id=' || new.project_id
      from public.client_users cu where cu.client_id = v_client and cu.user_id <> new.sender_id;
  else
    insert into public.notifications(user_id, title, body, link)
      select a.id, 'New client message', coalesce(v_title,'Project') || ': ' || left(new.body, 140),
             'project-details.html?id=' || new.project_id
      from public.profiles a where a.role = 'admin' and a.id <> new.sender_id;
  end if;
  return new;
end $$;
revoke all on function public.notify_new_message() from public, anon, authenticated;

drop trigger if exists trg_notify_new_message on public.messages;
create trigger trg_notify_new_message after insert on public.messages
  for each row execute function public.notify_new_message();
