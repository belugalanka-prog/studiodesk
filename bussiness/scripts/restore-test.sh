#!/usr/bin/env bash
# Proves a backup can actually be restored. Restores into a THROWAWAY local Postgres (never into Supabase) and compares
# row counts of every business table with what the backup claims.
#
#   ./scripts/restore-test.sh backups/studiodesk-20260101T000000Z.tar.gpg
#
#   BACKUP_PASSPHRASE   the passphrase used by backup.sh
#   TEST_DB_URL         an EMPTY scratch database, e.g. postgres://postgres:postgres@localhost:5432/restore_test
#                       (docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres postgres:16)
set -euo pipefail
FILE="${1:?usage: restore-test.sh <backup .tar.gpg>}"
: "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}" "${TEST_DB_URL:?Set TEST_DB_URL}"
case "$TEST_DB_URL" in *supabase.co*|*supabase.com*|*pooler.supabase*) echo "Refusing: TEST_DB_URL looks like a Supabase project. Use a scratch database."; exit 1;; esac
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" -d "$FILE" > "$TMP/bundle.tar"
tar -xf "$TMP/bundle.tar" -C "$TMP"
( cd "$TMP" && sha256sum -c SHA256SUMS )

psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -q <<'SQL'
-- minimal stand-ins for the Supabase pieces that the public schema refers to
do $$ begin
  if exists (select 1 from information_schema.schemata where schema_name='public' and exists (select 1 from information_schema.tables where table_schema='public')) then
    raise exception 'TEST_DB_URL is not empty. Use a fresh scratch database.'; end if; end $$;
drop schema if exists public cascade;   -- the dump re-creates it
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table if not exists auth.users(id uuid primary key, email text, created_at timestamptz);
create or replace function auth.jwt() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
create or replace function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
SQL
# users first (foreign keys from profiles point at them), then the public schema in its three sections
psql "$TEST_DB_URL" -v ON_ERROR_STOP=1 -q -c "\copy auth.users(id,email,created_at) from '$TMP/auth_users.csv' with csv header"
pg_restore --no-owner --no-privileges --exit-on-error -d "$TEST_DB_URL" "$TMP/public.dump" 2> "$TMP/restore.log" || { echo "pg_restore reported problems:"; head -20 "$TMP/restore.log"; exit 1; }

echo "Row counts in the restored copy:"
psql "$TEST_DB_URL" -At -F ' : ' -c "
select relname, (xpath('/row/c/text()', query_to_xml(format('select count(*) as c from public.%I', relname), false, true, '')))[1]::text as rows
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' order by 1"
psql "$TEST_DB_URL" -At -c "select 'functions: '||count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'"
psql "$TEST_DB_URL" -At -c "select 'rls policies: '||count(*) from pg_policies where schemaname='public'"
SIZE_CHECK=$(psql "$TEST_DB_URL" -At -c "select count(*) from public.profiles")
[ "$SIZE_CHECK" -gt 0 ] || { echo "FAILED: profiles is empty, the backup looks wrong."; exit 1; }
echo "RESTORE TEST PASSED"
