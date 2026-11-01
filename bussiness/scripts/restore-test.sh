#!/usr/bin/env bash
# Proves a backup can really be restored: loads it into a scratch database and compares row counts.
# Usage: SOURCE_DB_URL=<live db url> RESTORE_ADMIN_URL=<postgres url of a scratch server> ./restore-test.sh backup.sql.gz
set -euo pipefail
: "${RESTORE_ADMIN_URL:?Set RESTORE_ADMIN_URL (any empty Postgres server you may create databases on)}"
: "${SOURCE_DB_URL:?Set SOURCE_DB_URL}"
backup="${1:?Pass the backup file}"
db="restore_test_$$"; work="$(mktemp -d)"
psql "$RESTORE_ADMIN_URL" -qc "create database $db"
trap 'psql "$RESTORE_ADMIN_URL" -qc "drop database if exists $db" >/dev/null; rm -rf "$work"' EXIT
# same server and options as RESTORE_ADMIN_URL, different database name
T="$(printf '%s' "$RESTORE_ADMIN_URL" | sed -E "s#^([^?]*/)[^/?]*(\?.*)?\$#\1$db\2#")"
# Minimal stand-ins for the Supabase-managed pieces the public schema points at.
psql "$T" -q -v ON_ERROR_STOP=1 <<'SQL'
do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
create schema if not exists auth;
create table auth.users(id uuid primary key, email text, raw_user_meta_data jsonb);
create function auth.uid() returns uuid language sql stable as $f$ select null::uuid $f$;
create function auth.jwt() returns jsonb language sql stable as $f$ select '{}'::jsonb $f$;
SQL
# auth.users rows are not part of the public dump, so rows pointing at them (profiles...) may be rejected by the stub; the
# comparison below only fails for tables where that is not expected, so list rejected statements for review.
gzip -dc "$backup" | psql "$T" -q -v ON_ERROR_STOP=0 -o /dev/null 2>"$work/restore.err" || true
[ -s "$work/restore.err" ] && { echo "Statements rejected during restore (first 10):"; grep -i error "$work/restore.err" | head -10; }
count() { psql "$1" -Atc "select format('select %L, count(*) from public.%I', tablename, tablename) from pg_tables where schemaname='public' order by 1" | while read -r q; do psql "$1" -At -F' ' -c "$q"; done; }
count "$SOURCE_DB_URL" > "$work/src.counts"; count "$T" > "$work/dst.counts"
if diff -u "$work/src.counts" "$work/dst.counts"; then echo "RESTORE TEST PASSED: $(wc -l < "$work/src.counts") tables, identical row counts"; else echo "RESTORE TEST FAILED" >&2; exit 1; fi
