-- For chemical meters, lets Admin specify whether the site has a level
-- PROBE (continuous reading, e.g. a percentage or volume-remaining sensor)
-- or a float SWITCH (binary low/ok signal — the original behavior). Not
-- every site has a probe installed for every chemical.
alter table public.site_meters
  add column if not exists sensor_type text not null default 'switch';

alter table public.site_meters
  drop constraint if exists site_meters_sensor_type_check;

alter table public.site_meters
  add constraint site_meters_sensor_type_check check (sensor_type in ('switch', 'probe'));

comment on column public.site_meters.sensor_type is
  'For chemical meters: "switch" = binary float switch (low/ok), "probe" = continuous level sensor. Ignored for non-chemical meter types.';
