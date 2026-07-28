-- Adds a free-text "machine type" field per site (e.g. HMI/PLC model,
-- wash machine model/type), editable from Admin.
alter table public.sites
  add column if not exists machine_type text;

comment on column public.sites.machine_type is
  'Free-text description of the wash machine / HMI-PLC hardware at this site, e.g. "Delta DOP-107EV, rollover".';
