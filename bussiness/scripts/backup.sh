#!/usr/bin/env bash
# Encrypted backup of the StudioDesk database (the "public" schema: every business table, function, policy and trigger)
# plus the list of auth users (ids + emails) needed to re-link accounts.
#
#   SUPABASE_DB_URL      Supabase dashboard -> Connect -> "Session pooler" connection string (with your DB password)
#   BACKUP_PASSPHRASE    long random passphrase; WITHOUT IT THE BACKUP CANNOT BE OPENED. Keep a copy in your password manager.
#   OUT_DIR              where to write the file (default ./backups)
#
# Needs: pg_dump 15+ (same major version as Supabase, or newer), gpg, gzip.
set -euo pipefail
: "${SUPABASE_DB_URL:?Set SUPABASE_DB_URL}" "${BACKUP_PASSPHRASE:?Set BACKUP_PASSPHRASE}"
OUT_DIR="${OUT_DIR:-./backups}"; mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT

# custom format = compressed and lets pg_restore restore the pre-data / data / post-data sections separately
pg_dump "$SUPABASE_DB_URL" --schema=public --no-owner --no-privileges --format=custom --file="$TMP/public.dump"
# auth users: ids and e-mails only (passwords stay in Supabase; users can reset them if the project is ever rebuilt)
psql "$SUPABASE_DB_URL" -v ON_ERROR_STOP=1 -At -c "copy (select id, email, created_at from auth.users order by created_at) to stdout with csv header" > "$TMP/auth_users.csv"
( cd "$TMP" && sha256sum public.dump auth_users.csv > SHA256SUMS && tar -cf bundle.tar public.dump auth_users.csv SHA256SUMS )

FILE="$OUT_DIR/studiodesk-$STAMP.tar.gpg"
gpg --batch --yes --pinentry-mode loopback --passphrase "$BACKUP_PASSPHRASE" --symmetric --cipher-algo AES256 -o "$FILE" "$TMP/bundle.tar"
echo "Wrote $FILE ($(du -h "$FILE" | cut -f1))"
