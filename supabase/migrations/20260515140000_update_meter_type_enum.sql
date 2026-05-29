-- Add 'chemical_flow' to the meter_type enum
ALTER TYPE public.meter_type ADD VALUE IF NOT EXISTS 'chemical_flow';

-- Ensure the site_meters table correctly references the enum
-- (This is usually automatic, but good to ensure)
ALTER TABLE public.site_meters
ADD COLUMN IF NOT EXISTS chemical_group TEXT;
