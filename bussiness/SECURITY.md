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

## v4 additions
- **Admin MFA**: every admin should enrol an authenticator at `mfa.html` (Supabase → Authentication → Sign In / Providers → Multi-Factor: TOTP must be enabled). Once enrolled, a code is asked at every sign-in. In Settings → Admin security you can *require* MFA for all admins; the database then refuses admin actions from sessions that skipped the code. Enrol every admin first. Recovery if locked out: `update public.business_settings set enforce_admin_mfa=false;`
- **New-device alert**: an admin sign-in from a browser the account never used before notifies all admins (e-mailed through `notify-admin`). Failed-password alerts are not possible from the browser; Supabase Auth → Logs shows them.
- **Reminders by e-mail** reuse the `notify-admin` webhook; optional daily schedule: `select cron.schedule('studiodesk-reminders','0 3 * * *','select public.generate_reminders()');`
- **Payment slips** live in the private `payment-slips` bucket; clients can upload only into their own invoice folder.
