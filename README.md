# AIMOC Platform — Phase 1

Website + membership management for the **Australian Independent Motorsport Operators Council**.
Built to the 13 Oct 2026 development brief.

**Stack:** static site (Vercel) · Supabase (Postgres, auth, storage, edge functions) · Resend (email).
No build step. Running cost: Supabase free/Pro + Resend free/Pro + domain.

---

## What's included (Phase 1)

| Brief section | Built |
|---|---|
| 3 Public site | Home, About, Our Aims, Membership, Join, Industry News, Advocacy & Submissions, Member directory (consent-based), Contact form. Admin-editable in Markdown. |
| 4 Registration | Organisation-based wizard covering Sections A–F. Multiple categories/disciplines, statistics with period + exact/estimate + "N/A / Unknown / Prefer not to disclose", lead + additional contacts, six separately-recorded permissions. Draft saved on device. |
| 5 Portal (basic) | Status, view details/contacts/stats, org admins manage permissions, each contact manages own email opt-in. *Full self-service editing = Phase 2.* |
| 6 Communications | Rich-text email, templates, merge fields, attachments (secure links), segmentation by state / category / discipline / organisation / person / role / lead-only and any combination, live recipient count, preview, test send, approval workflow, scheduling, delivery + bounce + complaint tracking, per-org and per-contact history, one-click unsubscribe, audit. |
| 7 Reporting | Live filtered totals, consent-respecting, overlap adjustment via linked affiliations, exact vs estimate vs verified, coverage + reporting periods, small-group warnings. Export CSV, Excel, and a PDF briefing with sources, limitations and sharing notes. |
| 9 Security | Roles (Super Admin, Council Admin, Comms Editor, Org Admin, Org Rep) enforced in the database (Row Level Security), admin two-step verification, full audit log, full data export. |

Database is ready for Phase 2 (member docs bucket, members-only content, stats-update requests).

---

## Setup (about 45 minutes)

### 1. Supabase
1. Create a project (region: Sydney).
2. **SQL Editor** → run `supabase/schema.sql`, then `supabase/seed.sql`.
3. **Project Settings → API** → copy URL + anon key into `js/config.js`.
4. **Authentication → URL Configuration** → Site URL `https://aimoc.org.au` (or whichever domain), add it to Redirect URLs.
5. **Authentication → Email Templates** → paste `supabase/auth-email-template.html` into *Magic Link* and *Confirm signup* (replace `YOUR-SITE`).
6. **Authentication → Multi-Factor** → enable TOTP.

### 2. Email (Resend)
1. Add + verify a sending subdomain, e.g. `mail.aimoc.org.au` (keeps the mailbox MX records on the root domain clean).
2. Create an API key.
3. Supabase **Authentication → SMTP**: host `smtp.resend.com`, port `465`, user `resend`, password = API key, sender `noreply@mail.aimoc.org.au`.
4. Resend **Webhooks** → endpoint `https://<project>.supabase.co/functions/v1/resend-webhook`, all email events. Copy the signing secret.

### 3. Edge functions
```bash
supabase link --project-ref <project>
supabase secrets set RESEND_API_KEY=re_xxx SITE_URL=https://aimoc.org.au CRON_SECRET=<random> RESEND_WEBHOOK_SECRET=whsec_xxx
supabase functions deploy send-campaign
supabase functions deploy resend-webhook --no-verify-jwt
supabase functions deploy unsubscribe --no-verify-jwt
```
Then edit and run `supabase/cron.sql` (scheduled sends every 5 minutes).

### 4. Deploy site
Push this folder to GitHub → import to Vercel (framework: Other, no build) → add domain.

### 5. First admin
1. Open the site → **Log in** with your email → click the link.
2. SQL Editor: `select public.bootstrap_super_admin('you@example.com');`
3. Log in again → set up the authenticator app.
4. **Admin → Settings**: contact details, email From/Reply-to/footer, photos. Add other staff under **Admin → Staff**.

---

## Before launch — Council decisions needed
- **Consent wording** in `seed.sql` is a draft — get it approved (ideally legal review) before first registration. Change later via Admin → Settings → Consent wording (versioned).
- **Privacy policy** page (collecting personal info — Australian Privacy Principles).
- **Email footer** must identify the Council with a contact address (Spam Act).
- **Photos** — supply real venue/event photos you hold rights to (Admin → Settings → Photos).

## Brand
Logo files in `assets/` are a vector redraw of the concept board (not a pixel-exact trace). Replace with the designer's master files when available — same file names, nothing else changes.

## Photos
Default photos in `assets/photos/` are the supplied full-resolution track images (hero, page headers, join banner, three home cards). Get the full-resolution originals (or real venue photos) and either replace the files (same names) or upload via Admin → Settings → Photos.

## Files
```
index.html            single-page app shell
css/styles.css        styles (brand layer at the bottom)
js/core.js            client, auth, helpers, router
js/public.js          public pages
js/register.js        registration wizard + member portal
js/admin.js           admin: dashboard, organisations, content, settings, staff, audit, export
js/comms.js           communications
js/reports.js         reporting + exports
assets/               logos, icons, email logo, social card
supabase/             schema, seed, cron, auth email template, edge functions
```
