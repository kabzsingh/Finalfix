-- Add a per-site daily fresh water usage threshold (in liters).
-- When a site's fresh water usage for the current day exceeds this value,
-- the dashboard flags it. Null/0 means no threshold is set (no flagging).
alter table public.sites
  add column if not exists fresh_water_daily_threshold_liters numeric;

comment on column public.sites.fresh_water_daily_threshold_liters is
  'Daily fresh water usage threshold in liters. Dashboard flags the site when today''s usage exceeds this value. Null disables the flag.';
