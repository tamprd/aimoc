-- =====================================================================
--  AIMOC — COUNCIL POSITIONS (endorse / opt-out workflow)
--  Run after schema.sql (already included at the end of schema.sql for new installs).
--
--  Rules
--   • A position is sent to a fixed set of organisations (snapshot taken when opened).
--   • Each organisation may: expressly ENDORSE, OPT OUT, or WITHDRAW its response.
--   • Silence is NOT endorsement: no response = "No endorsement recorded".
--   • Responses are append-only history; the latest one counts.
--   • Every response records the version of the position text it was given on.
--   • Review closes at the end of the Nth business day (Mon–Fri, Brisbane time).
-- =====================================================================

create table if not exists public.council_positions (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null,
  jurisdiction         text,                       -- e.g. "Queensland Government"
  summary              text,
  body                 text not null default '',   -- markdown
  document_path        text,
  document_name        text,
  review_business_days int  not null default 5 check (review_business_days between 1 and 60),
  audience             jsonb not null default '{}',-- {states, category_ids, discipline_ids, org_ids, include_national}
  status               text not null default 'draft'
                       check (status in ('draft','open','closed','final','withdrawn')),
  version              int  not null default 1,
  opened_at            timestamptz,
  opened_by            uuid,
  closes_at            timestamptz,
  closed_at            timestamptz,
  reminder_sent_at     timestamptz,
  final_title          text,
  final_body           text,
  final_version        int,
  final_note           text,
  finalised_at         timestamptz,
  finalised_by         uuid,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create table if not exists public.position_versions (
  position_id uuid not null references public.council_positions on delete cascade,
  version     int  not null,
  title       text not null,
  summary     text,
  body        text not null,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  primary key (position_id, version)
);

-- Organisations asked (snapshot at opening) + when they were actually notified
create table if not exists public.position_recipients (
  position_id    uuid not null references public.council_positions on delete cascade,
  org_id         uuid not null references public.organisations on delete cascade,
  added_at       timestamptz not null default now(),
  notified_at    timestamptz,                    -- first successful notification email
  reminded_at    timestamptz,
  primary key (position_id, org_id)
);

create table if not exists public.position_responses (
  id             bigserial primary key,
  position_id    uuid not null references public.council_positions on delete cascade,
  org_id         uuid not null references public.organisations on delete cascade,
  response       text not null check (response in ('endorse','opt_out','withdrawn')),
  comment        text check (length(comment) <= 2000),
  version        int  not null,
  contact_id     uuid references public.contacts on delete set null,
  responder_name text,
  responded_by   uuid default auth.uid(),
  method         text not null default 'online' check (method in ('online','admin_on_behalf')),
  responded_at   timestamptz not null default now()
);
create index if not exists position_responses_idx on public.position_responses (position_id, org_id, responded_at desc);

create or replace view public.position_response_current with (security_invoker = true) as
  select distinct on (position_id, org_id) *
  from public.position_responses
  order by position_id, org_id, responded_at desc, id desc;

alter table public.campaigns add column if not exists position_id uuid references public.council_positions on delete set null;
alter table public.campaigns add column if not exists purpose text check (purpose in ('position_notice','position_reminder'));

-- ---------- helpers ----------
create or replace function public.add_business_days(p_start timestamptz, p_days int) returns timestamptz
language plpgsql immutable set search_path = public as $$
declare d date := (p_start at time zone 'Australia/Brisbane')::date; n int := 0;
begin
  while n < p_days loop
    d := d + 1;
    if extract(isodow from d) < 6 then n := n + 1; end if;
  end loop;
  return (d + time '23:59:59') at time zone 'Australia/Brisbane';
end $$;

create or replace function public.position_org(pid uuid, oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from position_recipients where position_id = pid and org_id = oid);
$$;

create or replace function public.can_respond_for(oid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from contacts where org_id = oid and user_id = auth.uid() and active
                 and (portal_access = 'org_admin' or authorised_to_speak or authorised_to_vote));
$$;

-- ---------- triggers ----------
create or replace function public.guard_position() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft'; new.version := 1; new.created_by := coalesce(auth.uid(), new.created_by);
    return new;
  end if;
  if old.status = 'final' and auth.uid() is not null then
    raise exception 'This position is final and can no longer be changed.';
  end if;
  -- text changed after opening → new version (responses keep the version they answered)
  if old.status <> 'draft' and (new.title, coalesce(new.summary,''), new.body) is distinct from (old.title, coalesce(old.summary,''), old.body) then
    new.version := old.version + 1;
  end if;
  if new.status = 'final' and old.status <> 'final' then
    new.final_title := new.title; new.final_body := new.body; new.final_version := new.version;
    new.finalised_at := now(); new.finalised_by := auth.uid();
    if old.closed_at is null then new.closed_at := now(); end if;
  end if;
  if new.status = 'closed' and old.status = 'open' then new.closed_at := coalesce(new.closed_at, now()); end if;
  return new;
end $$;
drop trigger if exists council_positions_guard on public.council_positions;
create trigger council_positions_guard before insert or update on public.council_positions
  for each row execute function public.guard_position();

create or replace function public.snapshot_position_version() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version or (old.status = 'draft' and new.status = 'open') then
    insert into position_versions (position_id, version, title, summary, body)
    values (new.id, new.version, new.title, new.summary, new.body)
    on conflict (position_id, version) do update set title = excluded.title, summary = excluded.summary, body = excluded.body, created_at = now();
  end if;
  return new;
end $$;
drop trigger if exists council_positions_version on public.council_positions;
create trigger council_positions_version after insert or update on public.council_positions
  for each row execute function public.snapshot_position_version();

drop trigger if exists council_positions_touch on public.council_positions;
create trigger council_positions_touch before update on public.council_positions for each row execute function public.touch_updated_at();
drop trigger if exists council_positions_audit on public.council_positions;
create trigger council_positions_audit after insert or update or delete on public.council_positions for each row execute function public.audit_trigger();
drop trigger if exists position_responses_audit on public.position_responses;
create trigger position_responses_audit after insert on public.position_responses for each row execute function public.audit_trigger();
drop trigger if exists position_recipients_audit on public.position_recipients;
create trigger position_recipients_audit after insert or delete on public.position_recipients for each row execute function public.audit_trigger();

-- ---------- actions ----------
-- Open a draft for review: snapshot recipient organisations, set the closing time.
create or replace function public.open_position(p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare p council_positions; a jsonb; n int;
begin
  if not is_council_admin() then raise exception 'Only a Council Administrator can open a position for review.'; end if;
  select * into p from council_positions where id = p_id for update;
  if p.id is null then raise exception 'Position not found.'; end if;
  if p.status <> 'draft' then raise exception 'Only draft positions can be opened.'; end if;
  if length(trim(p.body)) = 0 then raise exception 'Add the position text first.'; end if;
  a := p.audience;

  insert into position_recipients (position_id, org_id)
  select p.id, o.id from organisations o
  where o.status = 'approved'
    and (jsonb_array_length(coalesce(a->'states','[]')) = 0
         or o.state = any(array(select jsonb_array_elements_text(a->'states')))
         or o.operating_states && array(select jsonb_array_elements_text(a->'states'))
         or (coalesce((a->>'include_national')::boolean, true) and 'National' = any(o.operating_states)))
    and (jsonb_array_length(coalesce(a->'category_ids','[]')) = 0
         or exists (select 1 from organisation_categories oc where oc.org_id = o.id
                    and oc.category_id = any(array(select jsonb_array_elements_text(a->'category_ids')::int))))
    and (jsonb_array_length(coalesce(a->'discipline_ids','[]')) = 0
         or exists (select 1 from organisation_disciplines od where od.org_id = o.id
                    and od.discipline_id = any(array(select jsonb_array_elements_text(a->'discipline_ids')::int))))
    and (jsonb_array_length(coalesce(a->'org_ids','[]')) = 0
         or o.id = any(array(select jsonb_array_elements_text(a->'org_ids')::uuid)))
  on conflict do nothing;
  get diagnostics n = row_count;
  if n = 0 then raise exception 'No approved organisations match this audience.'; end if;

  update council_positions set status = 'open', opened_at = now(), opened_by = auth.uid(),
         closes_at = add_business_days(now(), review_business_days)
  where id = p.id;
  return jsonb_build_object('recipients', n, 'closes_at', add_business_days(now(), p.review_business_days));
end $$;

-- Organisation response (member portal) — or a council admin recording one on the organisation's instruction
create or replace function public.respond_to_position(p_position uuid, p_org uuid, p_response text, p_comment text default null)
returns void
language plpgsql security definer set search_path = public as $$
declare p council_positions; cid uuid; who text; on_behalf boolean := false;
begin
  if p_response not in ('endorse','opt_out','withdrawn') then raise exception 'Invalid response.'; end if;
  select * into p from council_positions where id = p_position;
  if p.id is null or not position_org(p_position, p_org) then raise exception 'This position was not sent to your organisation.'; end if;
  if not can_respond_for(p_org) then
    if is_council_admin() then on_behalf := true;
    else raise exception 'Only your organisation''s administrator or an authorised representative can respond.'; end if;
  end if;
  if p.status <> 'open' or now() > p.closes_at then raise exception 'The review period for this position has closed.'; end if;
  select id, full_name into cid, who from contacts where org_id = p_org and user_id = auth.uid() limit 1;
  insert into position_responses (position_id, org_id, response, comment, version, contact_id, responder_name, method)
  values (p_position, p_org, p_response, nullif(trim(p_comment), ''), p.version, cid,
          coalesce(who, auth.jwt()->>'email'), case when on_behalf then 'admin_on_behalf' else 'online' end);
end $$;

-- Results for admins (one row per recipient organisation)
create or replace function public.position_results(p_position uuid)
returns table (org_id uuid, org_name text, state text, notified_at timestamptz, reminded_at timestamptz,
               response text, comment text, response_version int, responder_name text, method text, responded_at timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not is_staff() then raise exception 'Not authorised.'; end if;
  return query
  select r.org_id, coalesce(o.trading_name, o.legal_name), o.state, r.notified_at, r.reminded_at,
         coalesce(nullif(c.response, 'withdrawn'), 'no_response'), c.comment, c.version, c.responder_name, c.method, c.responded_at
  from position_recipients r
  join organisations o on o.id = r.org_id
  left join position_response_current c on c.position_id = r.position_id and c.org_id = r.org_id
  where r.position_id = p_position
  order by 2;
end $$;

-- ---------- security ----------
alter table public.council_positions   enable row level security;
alter table public.position_versions   enable row level security;
alter table public.position_recipients enable row level security;
alter table public.position_responses  enable row level security;

drop policy if exists "positions read" on public.council_positions;
create policy "positions read" on public.council_positions for select
  using (is_staff() or (status <> 'draft' and exists (select 1 from position_recipients r where r.position_id = council_positions.id and is_org_member(r.org_id))));
drop policy if exists "positions write" on public.council_positions;
create policy "positions write" on public.council_positions for all using (is_council_admin()) with check (is_council_admin());

drop policy if exists "position versions read" on public.position_versions;
create policy "position versions read" on public.position_versions for select
  using (is_staff() or exists (select 1 from position_recipients r where r.position_id = position_versions.position_id and is_org_member(r.org_id)));

drop policy if exists "position recipients read" on public.position_recipients;
create policy "position recipients read" on public.position_recipients for select using (is_staff() or is_org_member(org_id));
drop policy if exists "position recipients admin" on public.position_recipients;
create policy "position recipients admin" on public.position_recipients for delete using (is_council_admin());

drop policy if exists "position responses read" on public.position_responses;
create policy "position responses read" on public.position_responses for select using (is_staff() or is_org_member(org_id));
-- inserts only through respond_to_position()

revoke all on function public.guard_position(), public.snapshot_position_version() from public, anon, authenticated;
revoke all on function public.open_position(uuid), public.respond_to_position(uuid,uuid,text,text), public.position_results(uuid) from public, anon;
grant execute on function public.open_position(uuid), public.respond_to_position(uuid,uuid,text,text), public.position_results(uuid) to authenticated;

-- ---------- automation ----------
-- Close open positions whose review period has ended (run by pg_cron every 5 minutes).
create or replace function public.close_due_positions() returns int
language plpgsql security definer set search_path = public as $$
declare n int;
begin
  update council_positions set status = 'closed', closed_at = closes_at
  where status = 'open' and closes_at < now();
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.close_due_positions() from public, anon, authenticated;

do $$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule('aimoc-close-positions') where exists (select 1 from cron.job where jobname = 'aimoc-close-positions');
    perform cron.schedule('aimoc-close-positions', '*/5 * * * *', 'select public.close_due_positions()');
  end if;
end $$;
