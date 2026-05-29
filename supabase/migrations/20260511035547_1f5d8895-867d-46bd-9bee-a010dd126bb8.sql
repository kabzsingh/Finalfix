create or replace function public.meter_totals(_site_id uuid)
returns table(meter_id uuid, total numeric)
language sql stable security definer set search_path = public as $$
  select meter_id, sum(value)::numeric from public.readings
  where site_id = _site_id group by meter_id
$$;

create or replace function public.meter_totals_since(_site_id uuid, _since timestamptz)
returns table(meter_id uuid, total numeric)
language sql stable security definer set search_path = public as $$
  select meter_id, sum(value)::numeric from public.readings
  where site_id = _site_id and recorded_at >= _since group by meter_id
$$;

grant execute on function public.meter_totals(uuid) to authenticated;
grant execute on function public.meter_totals_since(uuid, timestamptz) to authenticated;