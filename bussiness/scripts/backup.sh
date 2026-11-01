#!/usr/bin/env bash
# Dump the StudioDesk database (public schema: structure + data) to a compressed file.
# Usage: SUPABASE_DB_URL='postgresql://postgres:...@db.xxxx.supabase.co:5432/postgres' ./backup.sh [output-dir]
# Storage FILES (project files, bank slips) are not in a database dump - see SECURITY.md.
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL (Supabase -> Project Settings -> Database -> Connection string)}"
out_dir="${1:-.}"; mkdir -p "$out_dir"
file="$out_dir/studiodesk-$(date -u +%Y%m%dT%H%M%SZ).sql.gz"
pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges --quote-all-identifiers | gzip -9 > "$file"
[ "$(gzip -dc "$file" | wc -c)" -gt 1000 ] || { echo "Backup looks empty" >&2; rm -f "$file"; exit 1; }
echo "$file"
