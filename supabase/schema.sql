-- =====================================================================
--  AIMOC PLATFORM — DATABASE SCHEMA
--  Australian Independent Motorsport Operators Council
--  Phase 1 (with Phase 2 tables/permissions ready)
--
--  Run once in Supabase → SQL Editor (Postgres 15+).
--  Then run:  select public.bootstrap_super_admin('you@example.com');
--  (after that email has logged in to the site once).
-- =====================================================================

create extension if not exists pgcrypto;

-- =====================================================================
-- 1. LOOKUP LISTS  (editable by admins — no rebuild needed)
-- =====================================================================
create table public.org_categories (
  id     serial primary key,
  name   text not null unique,
  sort   int  not null default 100,
  active boolean not null default true
);

create table public.disciplines (
  id     serial primary key,
  name   text not null unique,
  sort   int  not null default 100,
  active boolean not null default true
);

create table public.contact_roles (
  id     serial primary key,
  name   text not null unique,
  sort   int  not null default 100,
  active boolean not null default true
);

-- Statistics captured in Section C. "kind" drives how totals are read:
--   people         = unique individuals (members, licence holders, volunteers…)
--   activity       = counts of activity (entries, events, spectators) — NOT people
--   infrastructure = venues
--   network        = affiliated clubs
create table public.stat_metrics (
  key               text primary key,
  label             text not null,
  description       text,
  kind              text not null check (kind in ('people','activity','infrastructure','network')),
  overlap_sensitive boolean not null default true,   -- may be double-counted across affiliated orgs
  sort              int not null default 100,
  active            boolean not null default true
);

-- Data-sharing permissions (Section F) and their versioned wording
create table public.consent_types (
  key         text primary key,
  label       text not null,
  sort        int  not null default 100
);

create table public.consent_statements (
  version     text not null,
  consent_key text not null references public.consent_types on update cascade,
  statement   text not null,
  created_at  timestamptz not null default now(),
  primary key (version, consent_key)
);

-- =====================================================================
-- 2. SITE SETTINGS (single row)
-- =====================================================================
create table public.site_settings (
  id                     int primary key default 1 check (id = 1),
  council_name           text not null default 'Australian Independent Motorsport Operators Council',
  short_name             text not null default 'AIMOC',
  tagline                text default 'A national voice for independent Australian motorsport',
  contact_email          text,
  contact_phone          text,
  postal_address         text,
  home_priorities        text default '',          -- markdown, shown on home page
  hero_image             text,                     -- photo URLs (public-docs bucket or external)
  card_about_image       text,
  card_membership_image  text,
  card_advocacy_image    text,
  directory_enabled      boolean not null default true,
  require_comms_approval boolean not null default true,
  require_admin_mfa      boolean not null default true,
  email_from_name        text default 'AIMOC',
  email_from_address     text,                     -- e.g. council@mail.aimoc.org.au (Resend-verified)
  email_reply_to         text,
  email_footer           text default '',          -- physical address / sender ID (Spam Act)
  consent_version        text not null default '1.0',
  updated_at             timestamptz not null default now()
);
insert into public.site_settings (id) values (1) on conflict do nothing;

-- =====================================================================
-- 3. ORGANISATIONS  (the core record)
-- =====================================================================
create table public.organisations (
  id                 uuid primary key default gen_random_uuid(),
  legal_name         text not null check (length(trim(legal_name)) > 1),
  trading_name       text,
  abn_acn            text,
  website            text,
  postal_address     text,
  state              text check (state in ('ACT','NSW','NT','QLD','SA','TAS','VIC','WA')),
  operating_states   text[] not null default '{}'
                     check (operating_states <@ array['ACT','NSW','NT','QLD','SA','TAS','VIC','WA','National']::text[]),
  operating_regions  text,
  year_established   int check (year_established between 1850 and 2100),
  description        text,
  logo_path          text,                         -- storage: org-logos bucket
  category_other     text,
  discipline_other   text,
  affiliated_with    text,                         -- free text from registration; admin links real affiliations
  status             text not null default 'pending'
                     check (status in ('pending','approved','rejected','inactive')),
  status_reason      text,
  approved_at        timestamptz,
  approved_by        uuid,
  stats_review_requested_at timestamptz,
  admin_notes        text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index organisations_status_idx on public.organisations (status);
create index organisations_state_idx  on public.organisations (state);
create index organisations_name_idx   on public.organisations (lower(legal_name));

create table public.organisation_categories (
  org_id      uuid not null references public.organisations on delete cascade,
  category_id int  not null references public.org_categories on delete restrict,
  primary key (org_id, category_id)
);

create table public.organisation_disciplines (
  org_id        uuid not null references public.organisations on delete cascade,
  discipline_id int  not null references public.disciplines on delete restrict,
  primary key (org_id, discipline_id)
);

-- Known relationships used to avoid double counting.
-- figures_included_in_parent = the parent's reported totals already include this org's people.
create table public.organisation_affiliations (
  child_org_id  uuid not null references public.organisations on delete cascade,
  parent_org_id uuid not null references public.organisations on delete cascade,
  figures_included_in_parent boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  primary key (child_org_id, parent_org_id),
  check (child_org_id <> parent_org_id)
);

-- =====================================================================
-- 4. CONTACTS  (principal + additional representatives)
-- =====================================================================
create table public.contacts (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid not null references public.organisations on delete cascade,
  user_id               uuid references auth.users on delete set null,   -- linked on first login
  full_name             text not null,
  position_title        text,
  email                 text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  phone                 text,
  preferred_contact     text not null default 'email' check (preferred_contact in ('email','phone','sms')),
  is_principal          boolean not null default false,
  authorised_to_speak   boolean not null default false,
  authorised_to_vote    boolean not null default false,
  receive_council_comms boolean not null default true,
  portal_access         text not null default 'none' check (portal_access in ('org_admin','org_rep','none')),
  role_other            text,
  active                boolean not null default true,
  unsubscribed_at       timestamptz,
  bounced_at            timestamptz,
  unsubscribe_token     uuid not null default gen_random_uuid() unique,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index contacts_one_principal on public.contacts (org_id) where is_principal and active;
create unique index contacts_org_email     on public.contacts (org_id, lower(email));
create index contacts_email_idx            on public.contacts (lower(email));
create index contacts_user_idx             on public.contacts (user_id);

create table public.contact_role_links (
  contact_id uuid not null references public.contacts on delete cascade,
  role_id    int  not null references public.contact_roles on delete restrict,
  primary key (contact_id, role_id)
);

-- Per-contact discipline subscriptions. Empty = receives all disciplines their org covers.
create table public.contact_disciplines (
  contact_id    uuid not null references public.contacts on delete cascade,
  discipline_id int  not null references public.disciplines on delete restrict,
  primary key (contact_id, discipline_id)
);

-- =====================================================================
-- 5. INDUSTRY STATISTICS  (per reporting period, never auto-summed)
-- =====================================================================
create table public.stat_submissions (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid not null references public.organisations on delete cascade,
  period_label        text not null,               -- "2025 calendar year", "FY 2025–26"
  period_start        date,
  period_end          date,
  includes_affiliates boolean not null default false, -- totals include affiliated clubs' people
  source_note         text,                        -- how the figures were derived
  submitted_by        uuid default auth.uid(),
  submitted_by_name   text,
  is_current          boolean not null default true,
  verified_at         timestamptz,
  verified_by         uuid,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  check (period_end is null or period_start is null or period_end >= period_start)
);
create unique index stat_one_current on public.stat_submissions (org_id) where is_current;

create table public.stat_values (
  submission_id uuid not null references public.stat_submissions on delete cascade,
  metric_key    text not null references public.stat_metrics on update cascade on delete restrict,
  answer        text not null default 'reported'
                check (answer in ('reported','not_applicable','unknown','not_disclosed')),
  value         numeric check (value >= 0),
  precision     text check (precision in ('exact','estimate')),
  notes         text,
  primary key (submission_id, metric_key),
  check ((answer = 'reported') = (value is not null)),
  check (answer <> 'reported' or precision is not null)
);

-- =====================================================================
-- 6. CONSENT RECORDS  (append-only history, dated + versioned)
-- =====================================================================
create table public.organisation_consents (
  id                bigserial primary key,
  org_id            uuid not null references public.organisations on delete cascade,
  consent_key       text not null references public.consent_types on update cascade,
  granted           boolean not null,
  statement_version text not null,
  statement_text    text not null,                 -- snapshot of the wording agreed to
  method            text not null default 'online' check (method in ('online','admin_on_behalf','imported')),
  contact_id        uuid references public.contacts on delete set null,
  recorded_by       uuid default auth.uid(),
  recorded_by_name  text,
  recorded_at       timestamptz not null default now()
);
create index organisation_consents_org_idx on public.organisation_consents (org_id, consent_key, recorded_at desc);

create view public.organisation_consent_current with (security_invoker = true) as
  select distinct on (org_id, consent_key) *
  from public.organisation_consents
  order by org_id, consent_key, recorded_at desc, id desc;

-- =====================================================================
-- 7. PUBLIC CONTENT
-- =====================================================================
create table public.pages (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title       text not null,
  summary     text,
  body        text not null default '',
  nav_order   int  not null default 50,
  show_in_nav boolean not null default true,
  published   boolean not null default false,
  updated_by  uuid default auth.uid(),
  updated_at  timestamptz not null default now()
);

-- News (kind = news) and Advocacy & Submissions (kind = submission)
create table public.posts (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'news' check (kind in ('news','submission')),
  slug          text not null unique check (slug ~ '^[a-z0-9-]+$'),
  title         text not null,
  topic         text,                              -- Consultation, Announcement, Position paper…
  excerpt       text,
  body          text not null default '',
  cover_image   text,
  document_path text,                              -- storage path (public-docs or member-docs)
  document_name text,
  members_only  boolean not null default false,
  published     boolean not null default false,
  published_at  timestamptz not null default now(),
  updated_by    uuid default auth.uid(),
  updated_at    timestamptz not null default now()
);
create index posts_pub_idx on public.posts (kind, published, published_at desc);

create table public.enquiries (
  id           uuid primary key default gen_random_uuid(),
  name         text not null check (length(name) between 1 and 200),
  email        text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  organisation text check (length(organisation) <= 300),
  phone        text check (length(phone) <= 50),
  subject      text check (length(subject) <= 300),
  message      text not null check (length(message) between 1 and 5000),
  created_at   timestamptz not null default now(),
  handled_at   timestamptz,
  handled_by   uuid,
  notes        text
);

-- =====================================================================
-- 8. COMMUNICATIONS
-- =====================================================================
create table public.email_templates (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  subject    text,
  body_html  text not null default '',
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- audience jsonb:
-- { states:[], include_national:true, category_ids:[], discipline_ids:[], org_ids:[], contact_ids:[],
--   role_ids:[], principal_only:false, include_pending:false }
create table public.campaigns (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  category       text not null default 'council' check (category in ('council','promotional')),
  subject        text not null default '',
  preheader      text,
  body_html      text not null default '',
  attachments    jsonb not null default '[]',      -- [{name, url, path, size}]
  audience       jsonb not null default '{}',
  status         text not null default 'draft'
                 check (status in ('draft','pending_approval','approved','scheduled','sending','sent','cancelled','failed')),
  scheduled_at   timestamptz,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_by     uuid,
  updated_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  approved_by    uuid,
  approved_at    timestamptz,
  sent_by        uuid,
  sent_at        timestamptz,
  recipient_count int,
  error          text
);
create index campaigns_sched_idx on public.campaigns (status, scheduled_at);

create table public.campaign_recipients (
  id            uuid primary key default gen_random_uuid(),
  campaign_id   uuid not null references public.campaigns on delete cascade,
  contact_id    uuid references public.contacts on delete set null,
  org_id        uuid references public.organisations on delete set null,
  email         text not null,
  full_name     text,
  org_name      text,
  status        text not null default 'queued'
                check (status in ('queued','sent','delivered','delayed','opened','clicked','bounced','complained','failed')),
  provider_id   text,
  error         text,
  sent_at       timestamptz,
  last_event_at timestamptz,
  unique (campaign_id, contact_id)
);
create index campaign_recipients_provider_idx on public.campaign_recipients (provider_id);
create index campaign_recipients_contact_idx  on public.campaign_recipients (contact_id);
create index campaign_recipients_org_idx      on public.campaign_recipients (org_id);

create table public.email_events (
  id          bigserial primary key,
  provider_id text,
  type        text,
  payload     jsonb,
  received_at timestamptz not null default now()
);

-- =====================================================================
-- 9. STAFF ROLES + AUDIT
-- =====================================================================
create table public.staff (
  user_id    uuid primary key references auth.users on delete cascade,
  email      text not null,
  full_name  text,
  role       text not null check (role in ('super_admin','council_admin','comms_editor')),
  active     boolean not null default true,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now()
);

create table public.audit_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  actor       uuid,
  actor_email text,
  action      text not null,
  entity      text not null,
  entity_id   text,
  changes     jsonb
);
create index audit_log_entity_idx on public.audit_log (entity, entity_id);
create index audit_log_at_idx     on public.audit_log (at desc);

-- =====================================================================
-- 10. ACCESS HELPERS
-- =====================================================================
create or replace function public.current_staff_role() returns text
language sql stable security definer set search_path = public as $$
  select s.role from staff s
  where s.user_id = auth.uid() and s.active
    and ( not (select require_admin_mfa from site_settings where id = 1)
          or coalesce(auth.jwt()->>'aal', 'aal1') = 'aal2' );
$$;

-- NB: always return true/false, never NULL (NULL slips through "if not …" checks)
create or replace function public.is_staff() returns boolean
language sql stable as $$ select public.current_staff_role() is not null $$;

create or replace function public.is_council_admin() returns boolean
language sql stable as $$ select coalesce(public.current_staff_role() in ('super_admin','council_admin'), false) $$;

create or replace function public.is_super_admin() returns boolean
language sql stable as $$ select coalesce(public.current_staff_role() = 'super_admin', false) $$;

-- For the UI: am I staff (ignoring MFA level) and do I still need to verify?
create or replace function public.my_staff_status() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'role', s.role,
    'active', s.active,
    'mfa_required', (select require_admin_mfa from site_settings where id = 1),
    'aal', coalesce(auth.jwt()->>'aal','aal1'))
  from staff s where s.user_id = auth.uid();
$$;

create or replace function public.my_org_ids() returns setof uuid
language sql stable security definer set search_path = public as $$
  select org_id from contacts where user_id = auth.uid() and active and portal_access <> 'none';
$$;

create or replace function public.is_org_member(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contacts
                 where org_id = o and user_id = auth.uid() and active and portal_access <> 'none');
$$;

create or replace function public.is_org_admin(o uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contacts
                 where org_id = o and user_id = auth.uid() and active and portal_access = 'org_admin');
$$;

create or replace function public.is_member_of_approved_org() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contacts c join organisations o on o.id = c.org_id
                 where c.user_id = auth.uid() and c.active and o.status = 'approved');
$$;

create or replace function public.contact_org(cid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from contacts where id = cid;
$$;

create or replace function public.submission_org(sid uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select org_id from stat_submissions where id = sid;
$$;

-- =====================================================================
-- 11. TRIGGERS — timestamps, audit, guards, linking
-- =====================================================================
create or replace function public.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;

do $$ declare t text; begin
  foreach t in array array['site_settings','organisations','contacts','stat_submissions','pages','posts','email_templates','campaigns']
  loop
    execute format('create trigger %I before update on public.%I for each row execute function public.touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

create or replace function public.audit_trigger() returns trigger
language plpgsql security definer set search_path = public as $$
declare o jsonb; n jsonb; diff jsonb := '{}'; k text; eid text;
begin
  if tg_op <> 'INSERT' then o := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then n := to_jsonb(new); end if;
  if tg_op = 'UPDATE' then
    for k in select jsonb_object_keys(n) loop
      if k <> 'updated_at' and (o->k) is distinct from (n->k) then
        diff := diff || jsonb_build_object(k, jsonb_build_array(o->k, n->k));
      end if;
    end loop;
    if diff = '{}'::jsonb then return new; end if;
  elsif tg_op = 'INSERT' then diff := n;
  else diff := o;
  end if;
  diff := diff - 'unsubscribe_token';
  if diff ? 'body_html' then diff := jsonb_set(diff, '{body_html}', '"(content changed)"'); end if;
  if diff ? 'body'      then diff := jsonb_set(diff, '{body}',      '"(content changed)"'); end if;
  eid := coalesce(n->>'id', o->>'id', n->>'org_id', o->>'org_id', n->>'user_id', o->>'user_id',
                  n->>'submission_id', o->>'submission_id', n->>'contact_id', o->>'contact_id',
                  n->>'child_org_id', o->>'child_org_id', n->>'key', o->>'key');
  insert into audit_log (actor, actor_email, action, entity, entity_id, changes)
  values (auth.uid(), auth.jwt()->>'email', lower(tg_op), tg_table_name, eid, diff);
  return coalesce(new, old);
end $$;

do $$ declare t text; begin
  foreach t in array array[
    'organisations','organisation_categories','organisation_disciplines','organisation_affiliations',
    'contacts','contact_role_links','contact_disciplines','stat_submissions','stat_values',
    'organisation_consents','campaigns','email_templates','staff','site_settings','pages','posts',
    'org_categories','disciplines','contact_roles','stat_metrics','consent_types','consent_statements']
  loop
    execute format('create trigger %I after insert or update or delete on public.%I for each row execute function public.audit_trigger()', t || '_audit', t);
  end loop;
end $$;

-- Organisation: only council admins change status / admin fields
create or replace function public.guard_organisation() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_council_admin() then
    if new.status = 'approved' and old.status is distinct from 'approved' then
      new.approved_at := coalesce(new.approved_at, now());
      new.approved_by := coalesce(new.approved_by, auth.uid());
    end if;
    return new;
  end if;
  new.status := old.status; new.status_reason := old.status_reason;
  new.approved_at := old.approved_at; new.approved_by := old.approved_by;
  new.admin_notes := old.admin_notes; new.created_by := old.created_by;
  new.stats_review_requested_at := old.stats_review_requested_at;
  return new;
end $$;
create trigger organisations_guard before update on public.organisations
  for each row execute function public.guard_organisation();

-- Contacts: members can't touch system fields
create or replace function public.guard_contact() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_council_admin() then return new; end if;
  new.user_id := old.user_id;
  new.unsubscribe_token := old.unsubscribe_token;
  new.bounced_at := old.bounced_at;
  new.org_id := old.org_id;
  if not is_org_admin(old.org_id) then           -- self-edit: no permission changes
    new.portal_access := old.portal_access;
    new.is_principal := old.is_principal;
    new.authorised_to_speak := old.authorised_to_speak;
    new.authorised_to_vote := old.authorised_to_vote;
    new.active := old.active;
  end if;
  -- re-subscribing clears the unsubscribe stamp
  if new.receive_council_comms and not old.receive_council_comms then new.unsubscribed_at := null; end if;
  return new;
end $$;
create trigger contacts_guard before update on public.contacts
  for each row execute function public.guard_contact();

-- Statistics: one current submission per organisation
create or replace function public.stat_set_current() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.is_current then
    update stat_submissions set is_current = false
    where org_id = new.org_id and is_current and id <> new.id;
  end if;
  return new;
end $$;
create trigger stat_submissions_current before insert or update of is_current on public.stat_submissions
  for each row execute function public.stat_set_current();

-- Statistics: verification only by council admins; members editing a verified submission un-verifies it
create or replace function public.guard_stat_submission() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null or is_council_admin() then
    if new.verified_at is not null and old.verified_at is null then new.verified_by := auth.uid(); end if;
    return new;
  end if;
  new.verified_at := null; new.verified_by := null;
  return new;
end $$;
create trigger stat_submissions_guard before update on public.stat_submissions
  for each row execute function public.guard_stat_submission();

-- Site settings: only super admin can switch off MFA
create or replace function public.guard_settings() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is not null and not is_super_admin() then
    new.require_admin_mfa := old.require_admin_mfa;
  end if;
  return new;
end $$;
create trigger site_settings_guard before update on public.site_settings
  for each row execute function public.guard_settings();

-- Campaign workflow rules
create or replace function public.guard_campaign() returns trigger
language plpgsql security definer set search_path = public as $$
declare need_approval boolean;
begin
  if auth.uid() is null then return new; end if;  -- service role (sender / cron)

  if tg_op = 'INSERT' then
    new.status := 'draft'; new.approved_by := null; new.approved_at := null;
    new.sent_at := null; new.sent_by := null; new.recipient_count := null;
    new.created_by := auth.uid();
    return new;
  end if;

  if old.status in ('sending','sent') then
    raise exception 'This communication has already been sent and can no longer be changed.';
  end if;
  if new.status in ('sending','sent','failed') and new.status is distinct from old.status then
    raise exception 'Only the sending service can mark a communication as sent.';
  end if;

  select require_comms_approval into need_approval from site_settings where id = 1;
  new.updated_by := auth.uid();

  -- editing content or audience after approval sends it back to draft
  if old.status in ('approved','scheduled')
     and (new.subject, new.body_html, new.audience, new.attachments, new.category, coalesce(new.preheader,''))
         is distinct from (old.subject, old.body_html, old.audience, old.attachments, old.category, coalesce(old.preheader,''))
     and new.status = old.status then
    new.status := 'draft'; new.approved_by := null; new.approved_at := null; new.scheduled_at := null;
    return new;
  end if;

  if new.status = 'pending_approval' and old.status <> 'pending_approval' then
    new.submitted_at := now();
  end if;

  if new.status = 'approved' and old.status <> 'approved' then
    if not is_council_admin() then raise exception 'Only a Council Administrator can approve communications.'; end if;
    new.approved_by := auth.uid(); new.approved_at := now();
  end if;

  if new.status = 'scheduled' and old.status <> 'scheduled' then
    if new.scheduled_at is null or new.scheduled_at < now() - interval '5 minutes' then
      raise exception 'Choose a future send time.';
    end if;
    if need_approval and old.status <> 'approved' then
      if not is_council_admin() then raise exception 'This communication needs approval before it can be scheduled.'; end if;
      new.approved_by := auth.uid(); new.approved_at := now();
    end if;
  end if;

  if new.status = 'draft' and old.status <> 'draft' then
    new.approved_by := null; new.approved_at := null;
    if old.status = 'scheduled' then new.scheduled_at := null; end if;
  end if;
  return new;
end $$;
create trigger campaigns_guard before insert or update on public.campaigns
  for each row execute function public.guard_campaign();

-- Link logins to contact records by verified email
create or replace function public.link_contacts_to_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.email_confirmed_at is not null and new.email is not null then
    update contacts set user_id = new.id
    where lower(email) = lower(new.email) and user_id is null;
  end if;
  return new;
end $$;
create trigger on_auth_user_link_contacts
  after insert or update of email_confirmed_at, email on auth.users
  for each row execute function public.link_contacts_to_user();

-- =====================================================================
-- 12. RPC FUNCTIONS
-- =====================================================================

-- Claim contact records matching my (verified) login email
create or replace function public.claim_my_contacts() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'email','') = '' then return 0; end if;
  update contacts set user_id = auth.uid()
  where lower(email) = lower(auth.jwt()->>'email') and user_id is null;
  get diagnostics n = row_count;
  return n;
end $$;

-- Organisation registration (Sections A–F) — caller must be logged in as the lead contact
create or replace function public.register_organisation(p jsonb) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  uid      uuid := auth.uid();
  my_email text := lower(coalesce(auth.jwt()->>'email',''));
  o        jsonb := coalesce(p->'org','{}');
  l        jsonb := coalesce(p->'lead','{}');
  s        jsonb := p->'stats';
  ver      text;
  new_org  uuid;
  lead_id  uuid;
  sub_id   uuid;
  c        jsonb;
  cid      uuid;
  k        text;
  v        jsonb;
  dup      text;
  lead_name text;
begin
  if uid is null or my_email = '' then
    raise exception 'Please verify your email address before registering.';
  end if;
  if (select count(*) from organisations where created_by = uid and created_at > now() - interval '1 day') >= 5 then
    raise exception 'Too many registrations from this account today. Please contact the Council.';
  end if;
  if length(trim(coalesce(o->>'legal_name',''))) < 2 then raise exception 'Organisation name is required.'; end if;
  if coalesce(o->>'state','') = '' then raise exception 'State or territory is required.'; end if;
  if jsonb_array_length(coalesce(p->'category_ids','[]')) = 0 and coalesce(o->>'category_other','') = '' then
    raise exception 'Choose at least one organisation category.';
  end if;
  lead_name := trim(coalesce(l->>'full_name',''));
  if lead_name = '' then raise exception 'Lead contact name is required.'; end if;

  select string_agg(legal_name, ', ') into dup from organisations
  where lower(legal_name) = lower(trim(o->>'legal_name'))
     or (coalesce(o->>'abn_acn','') <> '' and regexp_replace(abn_acn,'\D','','g') = regexp_replace(o->>'abn_acn','\D','','g'));

  insert into organisations (legal_name, trading_name, abn_acn, website, postal_address, state,
                             operating_states, operating_regions, year_established, description, logo_path,
                             category_other, discipline_other, affiliated_with, status, admin_notes, created_by)
  values (trim(o->>'legal_name'), nullif(trim(o->>'trading_name'),''), nullif(trim(o->>'abn_acn'),''),
          nullif(trim(o->>'website'),''), nullif(trim(o->>'postal_address'),''), o->>'state',
          coalesce(array(select jsonb_array_elements_text(o->'operating_states')), '{}'),
          nullif(trim(o->>'operating_regions'),''), nullif(o->>'year_established','')::int,
          nullif(trim(o->>'description'),''), nullif(p->>'logo_path',''),
          nullif(trim(o->>'category_other'),''), nullif(trim(o->>'discipline_other'),''),
          nullif(trim(o->>'affiliated_with'),''), 'pending',
          case when dup is not null then 'Possible duplicate of: ' || dup end, uid)
  returning id into new_org;

  insert into organisation_categories (org_id, category_id)
  select new_org, x::int from jsonb_array_elements_text(coalesce(p->'category_ids','[]')) x
  where exists (select 1 from org_categories where id = x::int) on conflict do nothing;

  insert into organisation_disciplines (org_id, discipline_id)
  select new_org, x::int from jsonb_array_elements_text(coalesce(p->'discipline_ids','[]')) x
  where exists (select 1 from disciplines where id = x::int) on conflict do nothing;

  -- Section D: principal contact = the verified login
  insert into contacts (org_id, user_id, full_name, position_title, email, phone, preferred_contact, is_principal,
                        authorised_to_speak, authorised_to_vote, receive_council_comms, portal_access, role_other)
  values (new_org, uid, lead_name, nullif(trim(l->>'position_title'),''), my_email,
          nullif(trim(l->>'phone'),''), coalesce(nullif(l->>'preferred_contact',''),'email'), true,
          coalesce((l->>'authorised_to_speak')::boolean,false), coalesce((l->>'authorised_to_vote')::boolean,false),
          coalesce((l->>'receive_council_comms')::boolean,true), 'org_admin', nullif(trim(l->>'role_other'),''))
  returning id into lead_id;

  insert into contact_role_links (contact_id, role_id)
  select lead_id, x::int from jsonb_array_elements_text(coalesce(l->'role_ids','[]')) x
  where exists (select 1 from contact_roles where id = x::int) on conflict do nothing;

  -- Section E: additional contacts
  for c in select * from jsonb_array_elements(coalesce(p->'contacts','[]')) loop
    continue when trim(coalesce(c->>'full_name','')) = '' or trim(coalesce(c->>'email','')) = '';
    continue when lower(trim(c->>'email')) = my_email;
    insert into contacts (org_id, full_name, position_title, email, phone, preferred_contact,
                          authorised_to_speak, receive_council_comms, portal_access, role_other)
    values (new_org, trim(c->>'full_name'), nullif(trim(c->>'position_title'),''), lower(trim(c->>'email')),
            nullif(trim(c->>'phone'),''), coalesce(nullif(c->>'preferred_contact',''),'email'),
            coalesce((c->>'authorised_to_speak')::boolean,false), coalesce((c->>'receive_council_comms')::boolean,true),
            case when c->>'portal_access' in ('org_admin','org_rep','none') then c->>'portal_access' else 'org_rep' end,
            nullif(trim(c->>'role_other'),''))
    on conflict do nothing
    returning id into cid;
    if cid is not null then
      insert into contact_role_links (contact_id, role_id)
      select cid, x::int from jsonb_array_elements_text(coalesce(c->'role_ids','[]')) x
      where exists (select 1 from contact_roles where id = x::int) on conflict do nothing;
      insert into contact_disciplines (contact_id, discipline_id)
      select cid, x::int from jsonb_array_elements_text(coalesce(c->'discipline_ids','[]')) x
      where exists (select 1 from disciplines where id = x::int) on conflict do nothing;
    end if;
    cid := null;
  end loop;

  -- Section C: statistics
  if s is not null and coalesce(trim(s->>'period_label'),'') <> '' then
    insert into stat_submissions (org_id, period_label, period_start, period_end, includes_affiliates,
                                  source_note, submitted_by, submitted_by_name)
    values (new_org, trim(s->>'period_label'), nullif(s->>'period_start','')::date, nullif(s->>'period_end','')::date,
            coalesce((s->>'includes_affiliates')::boolean,false), nullif(trim(s->>'source_note'),''), uid, lead_name)
    returning id into sub_id;
    for k, v in select * from jsonb_each(coalesce(s->'values','{}')) loop
      continue when not exists (select 1 from stat_metrics where key = k);
      continue when coalesce(v->>'answer','') = '';
      insert into stat_values (submission_id, metric_key, answer, value, precision, notes)
      values (sub_id, k, v->>'answer',
              case when v->>'answer' = 'reported' then nullif(v->>'value','')::numeric end,
              case when v->>'answer' = 'reported' then coalesce(nullif(v->>'precision',''),'estimate') end,
              nullif(trim(v->>'notes'),''));
    end loop;
  end if;

  -- Section F: every permission recorded explicitly (unticked = not granted)
  select consent_version into ver from site_settings where id = 1;
  insert into organisation_consents (org_id, consent_key, granted, statement_version, statement_text,
                                     method, contact_id, recorded_by, recorded_by_name)
  select new_org, ct.key, coalesce((p->'consents'->>ct.key)::boolean, false), ver, cs.statement,
         'online', lead_id, uid, lead_name
  from consent_types ct join consent_statements cs on cs.consent_key = ct.key and cs.version = ver;

  return new_org;
end $$;

-- Record a permission change (org admin or council admin)
create or replace function public.record_consent(p_org uuid, p_key text, p_granted boolean) returns void
language plpgsql security definer set search_path = public as $$
declare ver text; txt text; who text; cid uuid;
begin
  if not (is_council_admin() or is_org_admin(p_org)) then raise exception 'Not authorised.'; end if;
  select consent_version into ver from site_settings where id = 1;
  select statement into txt from consent_statements where version = ver and consent_key = p_key;
  if txt is null then raise exception 'Unknown permission.'; end if;
  select id, full_name into cid, who from contacts where org_id = p_org and user_id = auth.uid() limit 1;
  insert into organisation_consents (org_id, consent_key, granted, statement_version, statement_text, method,
                                     contact_id, recorded_by, recorded_by_name)
  values (p_org, p_key, p_granted, ver, txt,
          case when is_org_admin(p_org) then 'online' else 'admin_on_behalf' end,
          cid, auth.uid(), coalesce(who, auth.jwt()->>'email'));
end $$;

-- Public member directory (only approved orgs that consented to BOTH identification and listing)
create or replace function public.public_directory()
returns table (id uuid, name text, trading_name text, state text, operating_states text[], website text,
               description text, logo_path text, categories text[], disciplines text[])
language sql stable security definer set search_path = public as $$
  select o.id, o.legal_name, o.trading_name, o.state, o.operating_states, o.website, o.description, o.logo_path,
         array(select c.name from organisation_categories oc join org_categories c on c.id = oc.category_id
               where oc.org_id = o.id order by c.sort, c.name),
         array(select d.name from organisation_disciplines od join disciplines d on d.id = od.discipline_id
               where od.org_id = o.id order by d.sort, d.name)
  from organisations o
  where o.status = 'approved'
    and (select directory_enabled from site_settings where id = 1)
    and exists (select 1 from organisation_consent_current cc where cc.org_id = o.id and cc.consent_key = 'public_directory' and cc.granted)
    and exists (select 1 from organisation_consent_current cc where cc.org_id = o.id and cc.consent_key = 'identify_member' and cc.granted)
  order by coalesce(o.trading_name, o.legal_name);
$$;

-- Public headline count (no identities)
create or replace function public.public_counts() returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'organisations', (select count(*) from organisations where status = 'approved'),
    'states', (select count(distinct state) from organisations where status = 'approved'),
    'disciplines', (select count(distinct od.discipline_id) from organisation_disciplines od
                    join organisations o on o.id = od.org_id where o.status = 'approved'));
$$;

-- Unsubscribe via emailed token (no login)
create or replace function public.unsubscribe_contact(token uuid) returns text
language plpgsql security definer set search_path = public as $$
declare e text;
begin
  update contacts set receive_council_comms = false, unsubscribed_at = coalesce(unsubscribed_at, now())
  where unsubscribe_token = token returning email into e;
  if e is null then return 'invalid'; end if;
  insert into audit_log (action, entity, entity_id, changes)
  values ('unsubscribe', 'contacts', (select id::text from contacts where unsubscribe_token = token),
          jsonb_build_object('via','email link'));
  return regexp_replace(e, '^(.).*(@.*)$', '\1•••\2');
end $$;

-- Audience resolution for communications (service role only; see wrapper below)
create or replace function public._campaign_audience(a jsonb)
returns table (contact_id uuid, org_id uuid, email text, full_name text, org_name text, is_principal boolean, unsubscribe_token uuid)
language sql stable security definer set search_path = public as $$
  with p as (
    select
      array(select jsonb_array_elements_text(coalesce(a->'states','[]')))                 as states,
      coalesce((a->>'include_national')::boolean, true)                                     as incl_nat,
      array(select jsonb_array_elements_text(coalesce(a->'category_ids','[]'))::int)       as cats,
      array(select jsonb_array_elements_text(coalesce(a->'discipline_ids','[]'))::int)     as discs,
      array(select jsonb_array_elements_text(coalesce(a->'org_ids','[]'))::uuid)           as orgs,
      array(select jsonb_array_elements_text(coalesce(a->'contact_ids','[]'))::uuid)       as cids,
      array(select jsonb_array_elements_text(coalesce(a->'role_ids','[]'))::int)           as roles,
      coalesce((a->>'principal_only')::boolean, false)                                      as principal_only,
      coalesce((a->>'include_pending')::boolean, false)                                     as incl_pending,
      coalesce(a->>'category', 'council')                                                   as comm_cat
  )
  select distinct on (lower(c.email))
         c.id, o.id, c.email, c.full_name, coalesce(o.trading_name, o.legal_name), c.is_principal, c.unsubscribe_token
  from contacts c
  join organisations o on o.id = c.org_id
  cross join p
  where c.active
    and c.receive_council_comms and c.unsubscribed_at is null and c.bounced_at is null
    and (o.status = 'approved' or (p.incl_pending and o.status = 'pending'))
    and (cardinality(p.states) = 0
         or o.state = any(p.states)
         or o.operating_states && p.states
         or (p.incl_nat and 'National' = any(o.operating_states)))
    and (cardinality(p.cats) = 0
         or exists (select 1 from organisation_categories oc where oc.org_id = o.id and oc.category_id = any(p.cats)))
    and (cardinality(p.discs) = 0
         or (exists (select 1 from organisation_disciplines od where od.org_id = o.id and od.discipline_id = any(p.discs))
             and (not exists (select 1 from contact_disciplines cd where cd.contact_id = c.id)
                  or exists (select 1 from contact_disciplines cd where cd.contact_id = c.id and cd.discipline_id = any(p.discs)))))
    and (cardinality(p.orgs) = 0 or o.id = any(p.orgs))
    and (cardinality(p.cids) = 0 or c.id = any(p.cids))
    and (cardinality(p.roles) = 0
         or exists (select 1 from contact_role_links r where r.contact_id = c.id and r.role_id = any(p.roles)))
    and (not p.principal_only or c.is_principal)
    and (p.comm_cat <> 'promotional'
         or exists (select 1 from organisation_consent_current cc
                    where cc.org_id = o.id and cc.consent_key = 'marketing_comms' and cc.granted))
  order by lower(c.email), c.is_principal desc, c.created_at;
$$;

-- Preview for staff (no tokens exposed)
create or replace function public.campaign_audience(a jsonb)
returns table (contact_id uuid, org_id uuid, email text, full_name text, org_name text, is_principal boolean)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised.'; end if;
  return query select x.contact_id, x.org_id, x.email, x.full_name, x.org_name, x.is_principal
               from _campaign_audience(a) x order by x.org_name, x.full_name;
end $$;

-- Staff management
create or replace function public.add_staff(p_email text, p_role text, p_name text default null) returns void
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if not is_super_admin() then raise exception 'Only a Super Administrator can manage staff.'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'No login found for %. Ask them to log in to the site once first.', p_email; end if;
  insert into staff (user_id, email, full_name, role) values (u, lower(trim(p_email)), p_name, p_role)
  on conflict (user_id) do update set role = excluded.role, active = true,
     full_name = coalesce(excluded.full_name, staff.full_name);
end $$;

-- One-off: first super admin (run in SQL editor; refuses once any staff exist)
create or replace function public.bootstrap_super_admin(p_email text) returns text
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if exists (select 1 from staff) then raise exception 'Staff already exist — use Admin → Staff.'; end if;
  select id into u from auth.users where lower(email) = lower(trim(p_email));
  if u is null then raise exception 'Log in to the site once with % first.', p_email; end if;
  insert into staff (user_id, email, role) values (u, lower(trim(p_email)), 'super_admin');
  return 'Super admin created for ' || p_email;
end $$;

-- Lock down internal / bootstrap functions
revoke all on function public._campaign_audience(jsonb) from public, anon, authenticated;
grant execute on function public._campaign_audience(jsonb) to service_role;
revoke all on function public.bootstrap_super_admin(text) from public, anon, authenticated;
revoke all on function public.register_organisation(jsonb) from public, anon;
grant execute on function public.register_organisation(jsonb) to authenticated;

-- =====================================================================
-- 13. ROW LEVEL SECURITY
-- =====================================================================
do $$ declare t text; begin
  foreach t in array array[
    'org_categories','disciplines','contact_roles','stat_metrics','consent_types','consent_statements',
    'site_settings','organisations','organisation_categories','organisation_disciplines','organisation_affiliations',
    'contacts','contact_role_links','contact_disciplines','stat_submissions','stat_values','organisation_consents',
    'pages','posts','enquiries','email_templates','campaigns','campaign_recipients','email_events','staff','audit_log']
  loop execute format('alter table public.%I enable row level security', t); end loop;
end $$;

-- Lookups: public read, council admin write
do $$ declare t text; begin
  foreach t in array array['org_categories','disciplines','contact_roles','stat_metrics','consent_types','consent_statements']
  loop
    execute format('create policy "%s read" on public.%I for select using (true)', t, t);
    execute format('create policy "%s admin" on public.%I for all using (public.is_council_admin()) with check (public.is_council_admin())', t, t);
  end loop;
end $$;

create policy "settings read"   on public.site_settings for select using (true);
create policy "settings update" on public.site_settings for update using (is_council_admin()) with check (is_council_admin());

-- Organisations
create policy "org read"   on public.organisations for select using (is_staff() or is_org_member(id));
create policy "org insert" on public.organisations for insert with check (is_council_admin());
create policy "org update" on public.organisations for update using (is_council_admin() or is_org_admin(id))
                                                              with check (is_council_admin() or is_org_admin(id));
create policy "org delete" on public.organisations for delete using (is_super_admin());

create policy "org cat read"  on public.organisation_categories for select using (is_staff() or is_org_member(org_id));
create policy "org cat write" on public.organisation_categories for all using (is_council_admin() or is_org_admin(org_id))
                                                                         with check (is_council_admin() or is_org_admin(org_id));
create policy "org disc read"  on public.organisation_disciplines for select using (is_staff() or is_org_member(org_id));
create policy "org disc write" on public.organisation_disciplines for all using (is_council_admin() or is_org_admin(org_id))
                                                                           with check (is_council_admin() or is_org_admin(org_id));
create policy "affil read"  on public.organisation_affiliations for select
  using (is_staff() or is_org_member(child_org_id) or is_org_member(parent_org_id));
create policy "affil write" on public.organisation_affiliations for all using (is_council_admin()) with check (is_council_admin());

-- Contacts
create policy "contact read"   on public.contacts for select using (is_staff() or is_org_member(org_id) or user_id = auth.uid());
create policy "contact insert" on public.contacts for insert with check (is_council_admin() or is_org_admin(org_id));
create policy "contact update" on public.contacts for update using (is_council_admin() or is_org_admin(org_id) or user_id = auth.uid())
                                                          with check (is_council_admin() or is_org_admin(org_id) or user_id = auth.uid());
create policy "contact delete" on public.contacts for delete using (is_council_admin() or (is_org_admin(org_id) and not is_principal));

create policy "contact roles read"  on public.contact_role_links for select using (is_staff() or is_org_member(contact_org(contact_id)));
create policy "contact roles write" on public.contact_role_links for all
  using (is_council_admin() or is_org_admin(contact_org(contact_id)))
  with check (is_council_admin() or is_org_admin(contact_org(contact_id)));
create policy "contact disc read"  on public.contact_disciplines for select using (is_staff() or is_org_member(contact_org(contact_id)));
create policy "contact disc write" on public.contact_disciplines for all
  using (is_council_admin() or is_org_admin(contact_org(contact_id)))
  with check (is_council_admin() or is_org_admin(contact_org(contact_id)));

-- Statistics
create policy "stats read"   on public.stat_submissions for select using (is_staff() or is_org_member(org_id));
create policy "stats insert" on public.stat_submissions for insert with check (is_council_admin() or is_org_admin(org_id));
create policy "stats update" on public.stat_submissions for update using (is_council_admin() or is_org_admin(org_id))
                                                                 with check (is_council_admin() or is_org_admin(org_id));
create policy "stats delete" on public.stat_submissions for delete using (is_super_admin());
create policy "stat values read"  on public.stat_values for select using (is_staff() or is_org_member(submission_org(submission_id)));
create policy "stat values write" on public.stat_values for all
  using (is_council_admin() or is_org_admin(submission_org(submission_id)))
  with check (is_council_admin() or is_org_admin(submission_org(submission_id)));

-- Consents: readable by staff + own org; written only via record_consent / registration (append-only)
create policy "consent read" on public.organisation_consents for select using (is_staff() or is_org_member(org_id));

-- Content
create policy "pages read"  on public.pages for select using (published or is_staff());
create policy "pages write" on public.pages for all using (is_council_admin()) with check (is_council_admin());
create policy "posts read"  on public.posts for select
  using ((published and published_at <= now() and (not members_only or is_member_of_approved_org())) or is_staff());
create policy "posts write" on public.posts for all using (is_council_admin()) with check (is_council_admin());

create policy "enquiry submit" on public.enquiries for insert with check (handled_at is null and handled_by is null and notes is null);
create policy "enquiry read"   on public.enquiries for select using (is_staff());
create policy "enquiry update" on public.enquiries for update using (is_staff()) with check (is_staff());
create policy "enquiry delete" on public.enquiries for delete using (is_super_admin());

-- Communications
create policy "templates read"   on public.email_templates for select using (is_staff());
create policy "templates insert" on public.email_templates for insert with check (is_staff());
create policy "templates update" on public.email_templates for update using (is_staff()) with check (is_staff());
create policy "templates delete" on public.email_templates for delete using (is_council_admin() or created_by = auth.uid());

create policy "campaigns read"   on public.campaigns for select using (is_staff());
create policy "campaigns insert" on public.campaigns for insert with check (is_staff());
create policy "campaigns update" on public.campaigns for update using (is_staff()) with check (is_staff());
create policy "campaigns delete" on public.campaigns for delete using (is_council_admin() and status in ('draft','cancelled'));

create policy "recipients read" on public.campaign_recipients for select using (is_staff() or is_org_member(org_id));
create policy "email events read" on public.email_events for select using (is_council_admin());

-- Staff + audit
create policy "staff read"  on public.staff for select using (is_staff() or user_id = auth.uid());
create policy "staff write" on public.staff for all using (is_super_admin()) with check (is_super_admin());
create policy "audit read"  on public.audit_log for select using (is_council_admin());

-- =====================================================================
-- 14. FILE STORAGE
-- =====================================================================
insert into storage.buckets (id, name, public) values
  ('org-logos',   'org-logos',   true),
  ('public-docs', 'public-docs', true),    -- submissions, public news docs, email attachments
  ('member-docs', 'member-docs', false)    -- members-only briefing papers
on conflict (id) do nothing;

create policy "logos read"   on storage.objects for select using (bucket_id = 'org-logos');
create policy "logos upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'org-logos' and ((storage.foldername(name))[1] = auth.uid()::text or public.is_staff()));
create policy "logos manage" on storage.objects for delete using (bucket_id = 'org-logos' and public.is_council_admin());

create policy "public docs read"  on storage.objects for select using (bucket_id = 'public-docs');
create policy "public docs write" on storage.objects for insert with check (bucket_id = 'public-docs' and public.is_staff());
create policy "public docs edit"  on storage.objects for update using (bucket_id = 'public-docs' and public.is_staff());
create policy "public docs del"   on storage.objects for delete using (bucket_id = 'public-docs' and public.is_council_admin());

create policy "member docs read"  on storage.objects for select
  using (bucket_id = 'member-docs' and (public.is_staff() or public.is_member_of_approved_org()));
create policy "member docs write" on storage.objects for insert with check (bucket_id = 'member-docs' and public.is_council_admin());
create policy "member docs del"   on storage.objects for delete using (bucket_id = 'member-docs' and public.is_council_admin());

-- =====================================================================
-- 15. HARDENING (Supabase security advisor)
-- =====================================================================
alter function public.is_staff() set search_path = public;
alter function public.is_council_admin() set search_path = public;
alter function public.is_super_admin() set search_path = public;
alter function public.touch_updated_at() set search_path = public;
revoke all on function public.audit_trigger(), public.guard_campaign(), public.guard_contact(), public.guard_organisation(),
  public.guard_settings(), public.guard_stat_submission(), public.link_contacts_to_user(), public.stat_set_current(),
  public.touch_updated_at() from public, anon, authenticated;
revoke all on function public.add_staff(text,text,text), public.campaign_audience(jsonb), public.claim_my_contacts(),
  public.record_consent(uuid,text,boolean), public.my_org_ids(), public.my_staff_status() from public, anon;
grant execute on function public.add_staff(text,text,text), public.campaign_audience(jsonb), public.claim_my_contacts(),
  public.record_consent(uuid,text,boolean), public.my_org_ids(), public.my_staff_status() to authenticated;
