-- =====================================================================
--  AIMOC — scheduled sending (run once, after deploying edge functions)
--  Checks every 5 minutes for communications whose scheduled time has passed.
--
--  Replace the three placeholders:
--    YOUR-PROJECT    → your Supabase project ref
--    YOUR-ANON-KEY   → Project Settings → API → anon key
--    YOUR-CRON-SECRET→ the same value you set with:  supabase secrets set CRON_SECRET=…
-- =====================================================================
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule('aimoc-scheduled-sends') where exists (select 1 from cron.job where jobname = 'aimoc-scheduled-sends');

select cron.schedule('aimoc-scheduled-sends', '*/5 * * * *', $$
  select net.http_post(
    url     := 'https://YOUR-PROJECT.supabase.co/functions/v1/send-campaign',
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'Authorization', 'Bearer YOUR-ANON-KEY',
                 'x-cron-secret', 'YOUR-CRON-SECRET'),
    body    := '{"run_scheduled": true}'::jsonb,
    timeout_milliseconds := 300000
  );
$$);
