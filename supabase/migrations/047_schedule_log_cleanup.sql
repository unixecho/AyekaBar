-- Automate cleanup_expired_logs() (046) via pg_cron, if the extension is
-- available on this project (it's listed as available-but-not-installed
-- per list_extensions — Supabase bundles it on every project, this just
-- turns it on). If this whole migration fails because pg_cron truly can't
-- be enabled here, cleanup_expired_logs() from 046 still exists and works
-- — it would just need an external trigger (a Vercel Cron hitting a
-- service-role-protected route) instead of this in-database schedule.
create extension if not exists pg_cron with schema pg_catalog;

-- Once a night is plenty for a monthly-granularity retention window — this
-- is not time-sensitive. unschedule-then-schedule makes this migration
-- safely re-runnable (cron.schedule errors on a duplicate job name).
select cron.unschedule(jobid) from cron.job where jobname = 'nightly-log-cleanup';
select cron.schedule(
  'nightly-log-cleanup',
  '0 3 * * *',
  $$select public.cleanup_expired_logs();$$
);
