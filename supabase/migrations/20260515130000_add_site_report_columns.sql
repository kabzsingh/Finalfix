-- Add reporting columns to sites table
ALTER TABLE public.sites
ADD COLUMN IF NOT EXISTS report_hour INTEGER DEFAULT 7,
ADD COLUMN IF NOT EXISTS report_recipients TEXT[] DEFAULT '{}',
ADD COLUMN IF NOT EXISTS daily_report_enabled BOOLEAN DEFAULT TRUE,
ADD COLUMN IF NOT EXISTS monthly_report_enabled BOOLEAN DEFAULT TRUE;
