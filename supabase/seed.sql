-- =====================================================================
--  AIMOC — STARTER DATA  (run after schema.sql)
--  All lists are editable later in Admin → Settings.
-- =====================================================================

insert into public.org_categories (name, sort) values
  ('Sanctioning body', 10), ('Motorsport club', 20), ('Association', 30), ('Circuit operator', 40),
  ('Venue owner', 50), ('Event promoter', 60), ('Event organiser', 70), ('Other industry participant', 90)
on conflict (name) do nothing;

insert into public.disciplines (name, sort) values
  ('Circuit racing', 10), ('Speedway', 20), ('Drag racing', 30), ('Rally and rallysprint', 40),
  ('Off-road and desert racing', 50), ('Motorkhana, khanacross and autocross', 60), ('Hillclimb and sprint', 70),
  ('Karting', 80), ('Drifting', 90), ('Roll racing and time attack', 100), ('Motorcycle competition', 110),
  ('Historic motorsport', 120), ('Land speed racing', 130)
on conflict (name) do nothing;

insert into public.contact_roles (name, sort) values
  ('President or Chairperson', 10), ('Secretary', 20), ('Chief Executive Officer', 30), ('General Manager', 40),
  ('Venue Manager', 50), ('Membership Manager', 60), ('Government Relations', 70),
  ('Technical or Safety Representative', 80), ('Media or Communications Representative', 90), ('Other', 100)
on conflict (name) do nothing;

insert into public.stat_metrics (key, label, description, kind, overlap_sensitive, sort) values
  ('affiliated_clubs',      'Affiliated clubs',                         'Number of clubs affiliated with your organisation.',                                  'network',        true,  10),
  ('individual_members',    'Individual members',                       'Unique people who hold membership of your organisation.',                             'people',         true,  20),
  ('competition_licences',  'Current competition licence holders',      'Unique people holding a current competition licence issued or recognised by you.',    'people',         true,  30),
  ('recreational_licences', 'Recreational / non-competition licence holders', 'Unique people holding a recreational, practice or non-competition licence.',     'people',         true,  40),
  ('unique_participants',   'Estimated unique annual participants',     'Different people who took part in at least one activity during the period — count each person once.', 'people', true, 50),
  ('competition_entries',   'Annual competition entries',               'Total entries across all events. One person entering 10 events = 10 entries.',      'activity',       true,  60),
  ('annual_events',         'Annual events conducted or sanctioned',    'Events you ran or sanctioned during the period.',                                     'activity',       true,  70),
  ('venues',                'Affiliated or operated venues',            'Venues you own, operate or have affiliated.',                                         'infrastructure', true,  80),
  ('volunteers',            'Volunteers',                               'Unique people who volunteered during the period.',                                    'people',         true,  90),
  ('paid_employees',        'Paid employees',                           'People directly employed (full-time, part-time or casual).',                          'people',         false, 100),
  ('annual_spectators',     'Estimated annual spectators / attendees',  'Total attendance across the period (not unique people).',                             'activity',       true,  110)
on conflict (key) do nothing;

insert into public.consent_types (key, label, sort) values
  ('aggregate_stats',   'Use statistics in aggregated reports',            10),
  ('identify_member',   'Identify us as an AIMOC participant',             20),
  ('public_directory',  'List us in the public member directory',          30),
  ('attribute_stats',   'Attribute statistics or statements to us by name',40),
  ('share_with_govt',   'Share organisation-specific information',         50),
  ('marketing_comms',   'Optional news, event and promotional emails',     60)
on conflict (key) do nothing;

-- DRAFT WORDING — have the Council (and ideally a lawyer) approve before launch.
-- To change wording later: add rows with a new version and update site_settings.consent_version.
insert into public.consent_statements (version, consent_key, statement) values
  ('1.0', 'aggregate_stats',  'AIMOC may include our organisation''s statistics in aggregated reports and government submissions, combined with figures from other organisations.'),
  ('1.0', 'identify_member',  'AIMOC may publicly identify our organisation as a participant in or member of the Council.'),
  ('1.0', 'public_directory', 'AIMOC may publish our organisation''s name, logo, description, website, state and disciplines in the public member directory.'),
  ('1.0', 'attribute_stats',  'AIMOC may attribute particular statistics or statements to our organisation by name in reports, submissions or presentations.'),
  ('1.0', 'share_with_govt',  'AIMOC may share our organisation-specific information directly with government agencies or other stakeholders. Where required, AIMOC will seek our further approval for each instance.'),
  ('1.0', 'marketing_comms',  'Our contacts may receive optional news, event and promotional communications. (Council announcements and consultations are sent separately and can be managed by each contact.)')
on conflict do nothing;

update public.site_settings set
  home_priorities = E'- **Building the industry database** — registering independent organisations and their participation figures\n- **Venue protection** — supporting existing circuits and new facilities\n- **Practical regulation** — proportionate, transparent rules for motorsport activities',
  email_footer = 'Australian Independent Motorsport Operators Council'
where id = 1;

-- ---------- Public pages (content from the development brief) ----------
insert into public.pages (slug, title, summary, body, nav_order, published) values
('about', 'About AIMOC',
 'Independent. United. Driving a stronger future.',
E'## Who we are\n\nThe Australian Independent Motorsport Operators Council (AIMOC) is a collaborative industry initiative established to represent the interests of independent motorsport organisations throughout Australia.\n\nAustralian motorsport comprises a diverse network of sanctioning bodies, clubs, venue operators, event promoters, volunteers and participants. These organisations contribute significantly to grassroots participation, regional economies, recreational opportunities and the sustainability of motorsport.\n\nAIMOC aims to provide a coordinated, independent voice for these organisations in discussions with governments, regulatory authorities and other stakeholders.\n\nThe Council is intended to complement the work of individual member organisations rather than replace their operational responsibilities or commercial independence.\n\n## Our mission\n\nTo represent, protect and advance the interests of independent motorsport organisations throughout Australia through collective advocacy, industry collaboration and evidence-based policy development.\n\n## What AIMOC is not\n\nAIMOC is not intended to become another motorsport sanctioning authority.\n\nThe Council will not issue competition licences, event permits or insurance products, nor will it direct the commercial operations of its members. Its role is industry representation, advocacy and collaboration.\n\n## Governance\n\n*Governance details will be published as the Council is formally established.*',
 10, true),
('aims', 'Our Aims',
 'Real representation. Real change.',
E'## Our stated aims\n\n1. **Independent representation** — Provide an independent national voice for motorsport organisations in dealings with government, regulators and industry stakeholders.\n2. **Fair recognition** — Promote equitable treatment and recognition of independent motorsport organisations, sanctioning bodies and event operators.\n3. **Venue protection** — Advocate for the sustainability of existing motorsport venues and support the development of new facilities.\n4. **Regulatory reform** — Encourage practical, transparent and proportionate regulations governing motorsport activities.\n5. **Grassroots development** — Support accessible and affordable motorsport participation across all disciplines.\n6. **Industry collaboration** — Encourage cooperation between independent organisations while respecting their commercial autonomy.\n7. **Economic recognition** — Demonstrate the economic, employment, tourism and community contributions of independent motorsport.\n8. **Evidence-based advocacy** — Collect reliable industry information to support submissions, policy recommendations and consultation with government.',
 20, true),
('membership', 'Membership',
 'Stronger together.',
E'## Who can join\n\nAIMOC membership is for **organisations**, not individuals. Eligible organisations include sanctioning bodies, motorsport clubs, associations, circuit operators, venue owners, event promoters, event organisers and other independent motorsport industry participants.\n\nAn organisation can register across multiple disciplines, venues and states.\n\n## Why participate\n\n- A collective voice in dealings with government, regulators and stakeholders\n- Council briefings, consultations and industry updates relevant to your disciplines and state\n- Evidence of the true scale of independent motorsport, built from figures supplied by participants\n- A say in policy positions through Council consultations\n\n## How your information is used\n\nYou choose — separately — whether AIMOC may use your statistics in aggregated reports, identify you as a participant, list you in the public directory, attribute figures to you by name, or share organisation-specific information. Membership alone does not mean your statistics or contact details will be published or disclosed.\n\n## How to join\n\nRegistration takes about 10–15 minutes. You''ll need your organisation details, a nominated lead contact, and your best available participation figures (estimates are fine — just tell us they''re estimates).\n\n[Register your organisation →](#/join)',
 30, true)
on conflict (slug) do nothing;

insert into public.posts (kind, slug, title, topic, excerpt, body, published) values
('news', 'aimoc-registrations-open', 'Organisation registrations now open', 'Announcement',
 'Independent motorsport organisations can now register with the Council.',
 E'AIMOC is now accepting registrations from independent motorsport organisations across Australia.\n\nThe more organisations that register — and share their participation figures — the stronger the case the Council can make to government on behalf of the whole sector.\n\n[Register your organisation](#/join)', true)
on conflict (slug) do nothing;
