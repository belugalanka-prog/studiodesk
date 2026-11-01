# StudioDesk security checklist

## Already in the code
| Area | What it does |
|---|---|
| Login pages | Generic error for bad credentials (no "email not found"), honeypot field, input length limits, browser-side slow-down after 5 failures (30s → 15 min), whitelisted `?msg=` text, optional Cloudflare Turnstile, 30-minute idle sign-out |
| Website enquiry (`enquiry.html`) | Calls `submit_enquiry()` only. Server-side validation, honeypot, rate limits (5/hour per IP, 3/hour per email, 300/hour overall), duplicate e-mails never create a second client and never reveal that a client exists |
| Database | `supabase/security.sql`: audit trail on 11 tables → `activity_logs`; append-only log; users cannot change their own role **or** profile e-mail; anonymous role has no table access |
| Hosting | `vercel.json`: CSP, HSTS, no framing, nosniff, referrer/permissions policy, `no-store` on HTML |
| Dependencies | Supabase JS pinned to an exact version |

## You must do these in the Supabase dashboard (they cannot be done from code)
1. **Authentication → Sign In / Providers → turn OFF "Allow new users to sign up"** (admins and clients are created by you).
2. **Authentication → Attack Protection**: enable CAPTCHA (Cloudflare Turnstile), then put the *site key* in `assets/js/config.js` as `TURNSTILE_SITE_KEY` (see `config.example.js`).
3. **Authentication → Rate Limits**: keep sign-in limits low (e.g. 10 per 5 minutes per IP).
4. **Authentication → Password**: minimum length 12, require mixed characters, enable leaked-password protection (Pro plan).
5. Turn on **MFA** for your admin account.
6. **URL Configuration**: Site URL = your Vercel domain only; remove unused redirect URLs.
7. In `vercel.json`, the CSP names the project URL `jinithhlnlxyzqkxrmhf.supabase.co`. Change it if you move to another project.

## Why the browser slow-down is not enough
Anything in the browser can be bypassed by calling the Supabase Auth API directly. The real brute-force defence is steps 2–3 above.

## Email alerts and portal invites (Edge Functions)
Deploy: `supabase functions deploy invite-client` and `supabase functions deploy notify-admin`.

Secrets (`supabase secrets set NAME=value`):
| Secret | Used by | Value |
|---|---|---|
| `SITE_URL` | both | your Vercel URL, e.g. `https://studio.example.com` |
| `RESEND_API_KEY` | notify-admin | key from resend.com |
| `FROM_EMAIL` | notify-admin | a sender on a domain you verified in Resend, e.g. `StudioDesk <alerts@yourdomain.com>` |
| `WEBHOOK_SECRET` | notify-admin | a long random string you invent |

Then in the dashboard: **Database → Webhooks → Create**: table `public.notifications`, event **Insert**, type *Supabase Edge Functions* → `notify-admin`, add HTTP header `x-webhook-secret` with the same value as `WEBHOOK_SECRET`.

In **Authentication → Email Templates**, edit the "Invite user" template with your studio's wording.

## Two-step verification (MFA) for admins
1. Sign in → **Settings → Security → Set up authenticator app**, scan the QR code, enter the code.
2. Only after that, press **Require two-step verification**. From then on the database itself refuses admin actions from a password-only session, not just the screens.
3. **Locked out?** Supabase → SQL Editor: `update public.business_settings set require_admin_mfa = false;`
4. Settings → Security also lists your last sign-ins, and you get an in-app (and e-mailed, if alerts are set up) notice when your account signs in from a new IP/browser.

## Backups
- `supabase/` free plan has no daily backups, so this repo includes `.github/workflows/backup.yml`: every night it dumps the database, **restores it into a scratch database and compares row counts**, then stores the file for 30 days.
- Setup: put the project in a **private** GitHub repository → Settings → Secrets → `SUPABASE_DB_URL` (Supabase → Project Settings → Database → connection string, "Session pooler").
- Run it by hand any time: `SUPABASE_DB_URL=... bussiness/scripts/backup.sh backups`
- **Not covered:** uploaded files (project files, bank slips) live in Supabase Storage. Download them periodically with the Supabase CLI (`supabase storage cp -r ss:///project-files ./files --experimental`) or keep copies of the originals.
- Also test a real restore into a free Supabase project once a quarter.

## Daily reminders (deadlines, shoots)
`features.sql` schedules `send_deadline_reminders()` with pg_cron at 07:30 Sri Lanka time. Enable **Database → Extensions → pg_cron** first, then run the file. Reminders are notifications; the `notify-admin` webhook turns them into e-mails.
