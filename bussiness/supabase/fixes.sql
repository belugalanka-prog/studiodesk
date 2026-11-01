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
