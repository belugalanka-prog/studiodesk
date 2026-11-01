# Backups and restore

Supabase's free tier does not keep daily backups, so StudioDesk ships its own.

## One-time setup (about 10 minutes)
1. Keep this repository **private** on GitHub.
2. Supabase → **Connect** → copy the **Session pooler** connection string and put your database password in it.
3. GitHub → repo → Settings → Secrets and variables → Actions → add:
   - `SUPABASE_DB_URL` – the string from step 2
   - `BACKUP_PASSPHRASE` – a long random passphrase. **Also save it in your password manager: without it a backup cannot be opened.**
4. Actions tab → **database-backup** → *Run workflow* (leave "restore test" ticked). Both steps should turn green.

From then on it backs up every night (02:00 Sri Lanka time) and re-proves the restore on the 1st of each month. Files are encrypted (AES-256) and kept as run artifacts for 30 days. Download the latest one now and then and keep a copy somewhere that isn't GitHub.

## What is covered
Everything in the database (clients, projects, invoices, payments, expenses, slips records, audit log…) and the e-mail/id list of user accounts. **Not covered:** the uploaded files themselves (project files and payment slips live in Supabase Storage). Copy them occasionally: Supabase → Storage → the bucket → download, or use `rclone` with Supabase's S3 endpoint.

## Restoring
Test restore (safe, uses a throw-away database, never touches Supabase):
```
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=restore_test postgres:16
BACKUP_PASSPHRASE=... TEST_DB_URL=postgres://postgres:postgres@localhost:5432/restore_test \
  ./scripts/restore-test.sh backups/studiodesk-XXXX.tar.gpg
```
Real disaster (new Supabase project): create the project, run `schema.sql`, `fixes.sql`, `upgrade.sql`, `security.sql`, `features.sql` to get the structure, recreate the admin/client users under Authentication, then load only the data with `pg_restore --data-only --disable-triggers --schema=public` from the decrypted `public.dump`. Practise this once on a spare project before you need it.
