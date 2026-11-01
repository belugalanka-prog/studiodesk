# Creative Business Management System

Static HTML/CSS/ES module application backed by Supabase (Auth, Postgres and private Storage), suitable for Vercel static hosting.

## Structure

- `index.html`, `login.html`, `client-login.html`: entry points
- `pages/`: admin and client views
- `assets/css/app.css`: shared responsive styling
- `assets/js/`: Supabase client, auth, data helpers and page controller
- `supabase/schema.sql`: schema, indexes, triggers, RLS policies and private bucket
- `supabase/functions/`: privileged invoice numbering and payment recording

## Setup

1. Create a Supabase project and run `supabase/schema.sql` in its SQL Editor.
2. In **Authentication → URL Configuration**, set your deployed Site URL and add local/deployed redirect URLs.
3. Copy `assets/js/config.example.js` to `assets/js/config.js` and set the project URL and anon/publishable key. This key is intended for browser use; never place a service-role key in this app.
4. Serve the repository root over HTTP (ES modules do not work from `file://`). For example: `python -m http.server 8080`.
5. Create an auth user, then in SQL Editor set its `profiles.role` to `admin` for the first administrator. The profile trigger creates the row automatically.
6. Deploy the repository as a Vercel static site. No build command is required; output directory is `.`.

## Security model

Database access is protected by RLS. Admins are provisioned manually by an existing project owner through Supabase; client accounts are linked to a client record by an admin. All client-facing policies scope rows through `client_users` and `auth.uid()`. The `project-files` bucket is private and object paths begin with the client UUID and project UUID. Do not disable RLS or expose a service-role key.

The `issue-invoice` and `record-payment` Edge Functions validate the authenticated administrator and perform privileged operations server-side. Configure `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` as function secrets. Deploy with `supabase functions deploy issue-invoice` and `supabase functions deploy record-payment`.

## Implemented foundation

The application includes responsive admin navigation, dashboards, searchable client/project/invoice/payment lists, client and project creation, status updates, project tasks, quotations, invoice views, file upload/download via signed URLs, project messaging, client portal views, and theme switching. Invoice PDF output uses the browser print dialog. Email delivery requires configuring an external provider and an Edge Function; payment collection is recorded manually (no payment gateway is configured).

## Vercel

Import the GitHub repository in Vercel, keep framework preset **Other**, leave build command empty, and use `.` as output directory. Configure the production domain in Supabase Auth redirect settings. Add `assets/js/config.js` only with public URL/key values; alternatively inject these public values in a generated config file during deployment. The Supabase anon key is safe to publish only with RLS correctly enabled.
