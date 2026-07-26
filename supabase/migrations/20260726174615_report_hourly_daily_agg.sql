-- The daily/monthly report builder previously fetched every raw reading
-- row (paginated 1000 at a time) and aggregated it in JS. For sites with
-- frequent readings (e.g. every 15s across many meters), a single day's
-- data required dozens of paginated Supabase calls, which on Cloudflare
-- Workers blows through the "subrequests per invocation" limit before the
-- report email is even sent ("Too many subrequests by single Worker
-- invocation"). These functions do the aggregation in Postgres instead,
-- so the report builder only needs ONE query per report.

-- Daily report: one row per meter per UTC hour bucket (matches the
-- existing hourKey = UTC hour behavior in send-reports.ts).
create or replace function public.report_hourly_agg(_site_id uuid, _from timestamptz, _to timestamptz)
returns table(meter_id uuid, hour_bucket int, sum_value numeric, count_value bigint, last_value numeric)
language sql stable security definer set search_path = public as $$
  select
    r.meter_id,
    extract(hour from (r.recorded_at at time zone 'UTC'))::int as hour_bucket,
    sum(r.value)::numeric as sum_value,
    count(*)::bigint as count_value,
    (array_agg(r.value order by r.recorded_at desc))[1]::numeric as last_value
  from public.readings r
  where r.site_id = _site_id
    and r.recorded_at >= _from
    and r.recorded_at < _to
  group by r.meter_id, extract(hour from (r.recorded_at at time zone 'UTC'))::int
$$;

-- Monthly report: one row per meter per local calendar day (per site
-- timezone), matching the existing ymdInTz(tz, ...) bucketing.
create or replace function public.report_daily_agg(_site_id uuid, _from timestamptz, _to timestamptz, _tz text)
returns table(meter_id uuid, day_bucket date, sum_value numeric, count_value bigint, last_value numeric)
language sql stable security definer set search_path = public as $$
  select
    r.meter_id,
    (r.recorded_at at time zone _tz)::date as day_bucket,
    sum(r.value)::numeric as sum_value,
    count(*)::bigint as count_value,
    (array_agg(r.value order by r.recorded_at desc))[1]::numeric as last_value
  from public.readings r
  where r.site_id = _site_id
    and r.recorded_at >= _from
    and r.recorded_at < _to
  group by r.meter_id, (r.recorded_at at time zone _tz)::date
$$;

grant execute on function public.report_hourly_agg(uuid, timestamptz, timestamptz) to authenticated, service_role;
grant execute on function public.report_daily_agg(uuid, timestamptz, timestamptz, text) to authenticated, service_role;

-- The insert-before-send bug: report_send_log rows were written BEFORE
-- sendEmail was attempted, so a failed send (e.g. the subrequest-limit
-- error above) still permanently marked that day as "sent" and blocked
-- all future retries. Add a partial unique index so only rows with
-- status = 'sent' block future sends; failed attempts can be retried.
drop index if exists report_send_log_site_id_report_type_period_key_key;
alter table public.report_send_log drop constraint if exists report_send_log_site_id_report_type_period_key_key;
create unique index if not exists report_send_log_sent_unique
  on public.report_send_log (site_id, report_type, period_key)
  where status = 'sent';
