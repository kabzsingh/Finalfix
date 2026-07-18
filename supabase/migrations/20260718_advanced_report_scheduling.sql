-- Advanced Report Scheduling System
-- Replace simple email subscriptions with scheduled reports

-- Add new columns to email_subscriptions
ALTER TABLE public.email_subscriptions ADD COLUMN IF NOT EXISTS scheduled_hour INT DEFAULT 7;
ALTER TABLE public.email_subscriptions ADD COLUMN IF NOT EXISTS timezone TEXT DEFAULT 'UTC';
ALTER TABLE public.email_subscriptions ADD COLUMN IF NOT EXISTS recipients TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE public.email_subscriptions ADD COLUMN IF NOT EXISTS send_daily BOOLEAN DEFAULT true;
ALTER TABLE public.email_subscriptions ADD COLUMN IF NOT EXISTS send_monthly BOOLEAN DEFAULT false;
ALTER TABLE public.email_subscriptions ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.email_subscriptions ADD COLUMN IF NOT EXISTS last_sent_at TIMESTAMPTZ;
ALTER TABLE public.email_subscriptions ADD COLUMN IF NOT EXISTS next_send_at TIMESTAMPTZ;

-- Create index for efficient scheduled query
CREATE INDEX IF NOT EXISTS idx_email_subscriptions_schedule 
ON public.email_subscriptions(is_active, next_send_at) 
WHERE is_active = true;

-- Create table for email send history
CREATE TABLE IF NOT EXISTS public.email_send_history (
  id BIGSERIAL PRIMARY KEY,
  subscription_id BIGINT NOT NULL REFERENCES public.email_subscriptions(id) ON DELETE CASCADE,
  site_id UUID NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  recipients TEXT[] NOT NULL,
  report_type TEXT NOT NULL CHECK (report_type IN ('daily', 'monthly', 'test')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  error_message TEXT,
  sent_at TIMESTAMPTZ DEFAULT now(),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_email_send_history_subscription ON public.email_send_history(subscription_id);
CREATE INDEX idx_email_send_history_site ON public.email_send_history(site_id);
CREATE INDEX idx_email_send_history_sent_at ON public.email_send_history(sent_at DESC);

-- Enable RLS
ALTER TABLE public.email_send_history ENABLE ROW LEVEL SECURITY;

-- RLS policies for email_send_history
CREATE POLICY "admins can view email send history" 
  ON public.email_send_history FOR SELECT 
  TO authenticated 
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

CREATE POLICY "admins can delete email send history" 
  ON public.email_send_history FOR DELETE 
  TO authenticated 
  USING (public.has_role(auth.uid(), 'admin'::public.app_role));

-- Function to calculate next send time
CREATE OR REPLACE FUNCTION public.calculate_next_send_time(
  p_scheduled_hour INT,
  p_timezone TEXT DEFAULT 'UTC'
)
RETURNS TIMESTAMPTZ AS $$
DECLARE
  v_next_send TIMESTAMPTZ;
  v_today_target TIMESTAMPTZ;
BEGIN
  -- Get today at the scheduled hour in the specified timezone
  v_today_target := (NOW() AT TIME ZONE p_timezone)::DATE 
    + (p_scheduled_hour || ':00')::TIME;
  v_today_target := v_today_target AT TIME ZONE p_timezone AT TIME ZONE 'UTC';
  
  -- If that time has passed, schedule for tomorrow
  IF v_today_target <= NOW() THEN
    v_next_send := v_today_target + INTERVAL '1 day';
  ELSE
    v_next_send := v_today_target;
  END IF;
  
  RETURN v_next_send;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant execute on new function
GRANT EXECUTE ON FUNCTION public.calculate_next_send_time(INT, TEXT) TO authenticated, anon;
