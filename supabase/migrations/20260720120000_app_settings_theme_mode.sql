-- The app_settings table already exists from an earlier migration
-- (20260526_site_branding.sql) with primary_color/accent_color/etc,
-- but is missing theme_mode which the App Theme admin panel needs.
-- This just adds the missing piece rather than recreating the table.

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS theme_mode text NOT NULL DEFAULT 'dark';

ALTER TABLE public.app_settings
  DROP CONSTRAINT IF EXISTS app_settings_theme_mode_check;

ALTER TABLE public.app_settings
  ADD CONSTRAINT app_settings_theme_mode_check
  CHECK (theme_mode IN ('light', 'dark'));

-- Make sure the RLS policies from the original migration are in place
-- (safe no-ops if they already exist)
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anyone can view app settings" ON public.app_settings;
CREATE POLICY "anyone can view app settings"
  ON public.app_settings
  FOR SELECT
  TO authenticated, anon
  USING (true);

DROP POLICY IF EXISTS "admins can manage app settings" ON public.app_settings;
CREATE POLICY "admins can manage app settings"
  ON public.app_settings
  FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Ask PostgREST to refresh its schema cache immediately, instead of
-- waiting for its next automatic refresh (this is what was causing
-- "Could not find the 'theme_mode' column ... in the schema cache").
NOTIFY pgrst, 'reload schema';
