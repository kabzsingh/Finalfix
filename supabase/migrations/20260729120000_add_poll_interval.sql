-- Lets Admin configure how often (in seconds) the ESP32 reads meters and
-- sends data to the dashboard for each site, instead of it being a fixed
-- 15-second constant baked into every generated sketch.
alter table public.sites
  add column if not exists poll_interval_seconds integer not null default 15;

alter table public.sites
  drop constraint if exists sites_poll_interval_check;

alter table public.sites
  add constraint sites_poll_interval_check check (poll_interval_seconds between 5 and 3600);

comment on column public.sites.poll_interval_seconds is
  'How often (seconds) the ESP32 sketch reads meters and sends data for this site. Only takes effect in sketches generated/flashed AFTER this is changed — does not update already-flashed devices remotely.';
