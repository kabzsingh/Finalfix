-- Add branding columns to sites table for custom colors, logos, and backgrounds
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS logo_url text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS background_url text;
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS primary_color text DEFAULT '#3b82f6';     -- Default blue
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS secondary_color text DEFAULT '#10b981';  -- Default green
ALTER TABLE public.sites ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#f59e0b';    -- Default amber

-- Create branding storage bucket for image uploads (optional - uses Supabase Storage)
-- This is for future use if you want to store images in Supabase Storage instead of URLs

-- Add theme preference to profiles (user-level dark/light preference)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS theme_preference text DEFAULT 'system'; -- 'dark', 'light', or 'system'

-- Create app_settings table for global defaults
CREATE TABLE IF NOT EXISTS public.app_settings (
  id BOOLEAN PRIMARY KEY DEFAULT TRUE,
  logo_url text,
  background_url text,
  primary_color text DEFAULT '#3b82f6',
  secondary_color text DEFAULT '#10b981',
  accent_color text DEFAULT '#f59e0b',
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT one_row CHECK (id = TRUE)
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "anyone can view app settings" 
  ON public.app_settings 
  FOR SELECT 
  TO authenticated, anon 
  USING (true);

CREATE POLICY "admins can manage app settings" 
  ON public.app_settings 
  FOR ALL 
  TO authenticated 
  USING (public.has_role(auth.uid(), 'admin')) 
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Insert default app settings if they don't exist
INSERT INTO public.app_settings (id, primary_color, secondary_color, accent_color)
VALUES (TRUE, '#3b82f6', '#10b981', '#f59e0b')
ON CONFLICT (id) DO NOTHING;
