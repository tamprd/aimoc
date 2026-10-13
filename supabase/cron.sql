-- =====================================================================
-- AIMOC — scheduled sends (pg_cron + pg_net)
-- The cron secret is generated inside the database and kept in Supabase
-- Vault; the send-campaign function checks it via cron_secret_ok().
-- Safe to re-run.
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'aimoc_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'aimoc_cron_secret', 'x-cron-secret for scheduled sends');
  end if;
end $$;

create or replace function public.cron_secret_ok(p text)
returns boolean language sql security definer stable
set search_path = ''
as $$
  select exists (select 1 from vault.decrypted_secrets where name = 'aimoc_cron_secret' and decrypted_secret = p);
$$;
revoke all on function public.cron_secret_ok(text) from public, anon, authenticated;
grant execute on function public.cron_secret_ok(text) to service_role;

select cron.unschedule('aimoc-scheduled-sends') where exists (select 1 from cron.job where jobname = 'aimoc-scheduled-sends');

select cron.schedule('aimoc-scheduled-sends', '*/5 * * * *', $job$
  select net.http_post(
    url := 'https://syygnadcmptbexbxlpxo.supabase.co/functions/v1/send-campaign',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InN5eWduYWRjbXB0YmV4YnhscHhvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE4ODExNzAsImV4cCI6MjEwNzQ1NzE3MH0.vqqCppAWfSABDJ5fjkLcxgU5X6VfnEMQ2NJYNT0o2zA',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'aimoc_cron_secret')
    ),
    body := '{"run_scheduled":true}'::jsonb,
    timeout_milliseconds := 60000
  );
$job$);
