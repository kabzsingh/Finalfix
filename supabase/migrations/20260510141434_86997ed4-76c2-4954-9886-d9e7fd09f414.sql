-- Add chemical_flow meter type for flow meters paired with chemical level sensors.
ALTER TYPE meter_type ADD VALUE IF NOT EXISTS 'chemical_flow';

-- Optional grouping label so a chemical can have a level meter + a flow meter paired together.
ALTER TABLE public.site_meters ADD COLUMN IF NOT EXISTS chemical_group text;