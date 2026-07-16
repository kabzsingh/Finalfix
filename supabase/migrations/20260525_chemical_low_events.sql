-- Track when chemicals go low, top up, and washes during low period
CREATE TABLE IF NOT EXISTS public.chemical_low_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  meter_id uuid NOT NULL REFERENCES public.site_meters(id) ON DELETE CASCADE,
  went_low_at timestamptz NOT NULL,
  topped_up_at timestamptz,
  wash_count_at_low int,
  wash_count_at_topup int,
  washes_during_low int GENERATED ALWAYS AS (
    CASE 
      WHEN topped_up_at IS NOT NULL THEN wash_count_at_topup - wash_count_at_low
      ELSE NULL
    END
  ) STORED,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chemical_low_events ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_chemical_low_events_site ON public.chemical_low_events(site_id);
CREATE INDEX idx_chemical_low_events_meter ON public.chemical_low_events(meter_id);
CREATE INDEX idx_chemical_low_events_went_low ON public.chemical_low_events(went_low_at DESC);

CREATE POLICY "users can view chemical events for accessible sites" 
  ON public.chemical_low_events 
  FOR SELECT 
  TO authenticated 
  USING (public.can_access_site(auth.uid(), site_id));

CREATE POLICY "admins can manage chemical events" 
  ON public.chemical_low_events 
  FOR ALL 
  TO authenticated 
  USING (public.has_role(auth.uid(), 'admin')) 
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Table to track current chemical state (0=full, 1=low) to detect transitions
CREATE TABLE IF NOT EXISTS public.chemical_state (
  meter_id uuid PRIMARY KEY REFERENCES public.site_meters(id) ON DELETE CASCADE,
  site_id uuid NOT NULL REFERENCES public.sites(id) ON DELETE CASCADE,
  current_state int NOT NULL DEFAULT 0,
  last_updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.chemical_state ENABLE ROW LEVEL SECURITY;

CREATE INDEX idx_chemical_state_site ON public.chemical_state(site_id);

CREATE POLICY "users can view chemical state for accessible sites" 
  ON public.chemical_state 
  FOR SELECT 
  TO authenticated 
  USING (public.can_access_site(auth.uid(), site_id));

CREATE POLICY "admins can manage chemical state" 
  ON public.chemical_state 
  FOR ALL 
  TO authenticated 
  USING (public.has_role(auth.uid(), 'admin')) 
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- RPC function to handle chemical state transition (called by ingest)
CREATE OR REPLACE FUNCTION public.handle_chemical_state_change(
  p_site_id uuid,
  p_meter_id uuid,
  p_new_state int,
  p_wash_meter_id uuid,
  p_now timestamptz DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_state int;
  v_current_wash_count int;
BEGIN
  -- Get previous state (default to 0 if not exists)
  SELECT current_state INTO v_old_state FROM public.chemical_state 
  WHERE meter_id = p_meter_id;
  
  IF v_old_state IS NULL THEN
    v_old_state := 0;
    INSERT INTO public.chemical_state (meter_id, site_id, current_state, last_updated_at)
    VALUES (p_meter_id, p_site_id, p_new_state, p_now)
    ON CONFLICT (meter_id) DO UPDATE SET current_state = p_new_state, last_updated_at = p_now;
  ELSE
    UPDATE public.chemical_state 
    SET current_state = p_new_state, last_updated_at = p_now
    WHERE meter_id = p_meter_id;
  END IF;

  -- If state changed, record the transition
  IF v_old_state != p_new_state THEN
    IF p_new_state = 1 THEN
      -- Chemical went LOW (0→1)
      GET LATEST wash reading for this site
      SELECT value INTO v_current_wash_count FROM public.readings 
      WHERE site_id = p_site_id AND meter_id = p_wash_meter_id
      ORDER BY recorded_at DESC LIMIT 1;
      
      -- Start new low event
      INSERT INTO public.chemical_low_events 
      (site_id, meter_id, went_low_at, wash_count_at_low)
      VALUES (p_site_id, p_meter_id, p_now, COALESCE(v_current_wash_count::int, 0));
      
      RETURN json_build_object('event', 'went_low', 'wash_count', COALESCE(v_current_wash_count::int, 0));
      
    ELSIF p_new_state = 0 AND v_old_state = 1 THEN
      -- Chemical was topped up (1→0)
      GET LATEST wash reading for this site
      SELECT value INTO v_current_wash_count FROM public.readings 
      WHERE site_id = p_site_id AND meter_id = p_wash_meter_id
      ORDER BY recorded_at DESC LIMIT 1;
      
      -- Mark most recent low event as topped up
      UPDATE public.chemical_low_events 
      SET topped_up_at = p_now, wash_count_at_topup = COALESCE(v_current_wash_count::int, 0)
      WHERE site_id = p_site_id 
        AND meter_id = p_meter_id 
        AND topped_up_at IS NULL
      ORDER BY went_low_at DESC LIMIT 1;
      
      RETURN json_build_object('event', 'topped_up', 'wash_count', COALESCE(v_current_wash_count::int, 0));
    END IF;
  END IF;

  RETURN json_build_object('event', 'no_change');
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_chemical_state_change(uuid, uuid, int, uuid, timestamptz) TO authenticated, anon;
