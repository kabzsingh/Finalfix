
ALTER TABLE public.sites
  ADD COLUMN IF NOT EXISTS report_hour integer NOT NULL DEFAULT 7,
  ADD COLUMN IF NOT EXISTS report_recipients text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS daily_report_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS monthly_report_enabled boolean NOT NULL DEFAULT true;

CREATE TABLE IF NOT EXISTS public.report_send_log (
  id bigserial PRIMARY KEY,
  site_id uuid NOT NULL,
  report_type text NOT NULL CHECK (report_type IN ('daily','monthly')),
  period_key text NOT NULL,
  recipients text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'sent',
  error text,
  sent_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (site_id, report_type, period_key)
);

ALTER TABLE public.report_send_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "admins read report log" ON public.report_send_log
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role));
