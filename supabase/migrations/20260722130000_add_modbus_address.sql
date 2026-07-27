-- Adds the HMI/PLC Modbus TCP Mapping Table address for each meter, so the
-- ESP32 sketch generator in Admin can produce a real, working register map
-- instead of guessing addresses from the meter's name.
alter table public.site_meters
  add column if not exists modbus_address integer;

comment on column public.site_meters.modbus_address is
  'The 1-based address from the HMI''s Modbus TCP Mapping Table (DOPSoft) for this meter, e.g. 3025. Null means not yet configured — the ESP32 sketch generator will flag it as a TODO.';
