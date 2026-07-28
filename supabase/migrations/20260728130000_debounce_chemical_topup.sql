-- Chemicals were flipping back to "OK" from a single noisy/blip reading
-- (float switch bounce, a brief misread, etc.) since the low->ok transition
-- was confirmed on ANY single reading that reported OK. Require the last 3
-- readings to all agree before clearing a low event — going LOW is still
-- immediate/unchanged, only clearing requires confirmation.

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
  v_recent_high_count int;
BEGIN
  SELECT current_state INTO v_old_state FROM public.chemical_state
  WHERE meter_id = p_meter_id;
  IF v_old_state IS NULL THEN v_old_state := 0; END IF;

  IF v_old_state = 0 AND p_new_state >= 1 THEN
    -- Going low is immediate — no debounce needed, we want to know right away.
    INSERT INTO public.chemical_state (meter_id, site_id, current_state, last_updated_at)
    VALUES (p_meter_id, p_site_id, p_new_state, p_now)
    ON CONFLICT (meter_id) DO UPDATE SET current_state = p_new_state, last_updated_at = p_now;

    SELECT value INTO v_current_wash_count FROM public.readings
    WHERE site_id = p_site_id AND meter_id = p_wash_meter_id
    ORDER BY recorded_at DESC LIMIT 1;

    INSERT INTO public.chemical_low_events
    (site_id, meter_id, went_low_at, wash_count_at_low)
    VALUES (p_site_id, p_meter_id, p_now, COALESCE(v_current_wash_count::int, 0));

    RETURN json_build_object('event', 'went_low', 'wash_count', COALESCE(v_current_wash_count::int, 0));

  ELSIF v_old_state >= 1 AND p_new_state = 0 THEN
    -- Potential top-up — require the last 3 readings for this meter to ALL
    -- report OK (< 1) before confirming. A single blip back to low
    -- anywhere in that window means we're not confident yet; leave the
    -- tracked state as still-low and wait for more confirmation.
    SELECT count(*) INTO v_recent_high_count FROM (
      SELECT value FROM public.readings
      WHERE meter_id = p_meter_id
      ORDER BY recorded_at DESC LIMIT 3
    ) recent WHERE value >= 1;

    IF v_recent_high_count > 0 THEN
      RETURN json_build_object('event', 'no_change', 'debounced', true);
    END IF;

    UPDATE public.chemical_state
    SET current_state = p_new_state, last_updated_at = p_now
    WHERE meter_id = p_meter_id;

    SELECT value INTO v_current_wash_count FROM public.readings
    WHERE site_id = p_site_id AND meter_id = p_wash_meter_id
    ORDER BY recorded_at DESC LIMIT 1;

    UPDATE public.chemical_low_events
    SET topped_up_at = p_now, wash_count_at_topup = COALESCE(v_current_wash_count::int, 0)
    WHERE id = (
      SELECT id FROM public.chemical_low_events
      WHERE site_id = p_site_id
        AND meter_id = p_meter_id
        AND topped_up_at IS NULL
      ORDER BY went_low_at DESC LIMIT 1
    );

    RETURN json_build_object('event', 'topped_up', 'wash_count', COALESCE(v_current_wash_count::int, 0));

  ELSE
    -- No state transition; just keep the timestamp fresh.
    UPDATE public.chemical_state
    SET current_state = p_new_state, last_updated_at = p_now
    WHERE meter_id = p_meter_id;
    RETURN json_build_object('event', 'no_change');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_chemical_state_change(uuid, uuid, int, uuid, timestamptz) TO authenticated, anon;

-- Same debounce for the counter-type RPC's reset (positive -> 0) detection.
CREATE OR REPLACE FUNCTION public.handle_chemical_counter_change(
  p_site_id uuid,
  p_meter_id uuid,
  p_counter_value int,
  p_now timestamptz DEFAULT now()
)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_value int;
  v_recent_positive_count int;
BEGIN
  SELECT current_state INTO v_old_value FROM public.chemical_state
  WHERE meter_id = p_meter_id;
  IF v_old_value IS NULL THEN v_old_value := 0; END IF;

  IF v_old_value = 0 AND p_counter_value > 0 THEN
    INSERT INTO public.chemical_state (meter_id, site_id, current_state, last_updated_at)
    VALUES (p_meter_id, p_site_id, p_counter_value, p_now)
    ON CONFLICT (meter_id) DO UPDATE SET current_state = p_counter_value, last_updated_at = p_now;

    INSERT INTO public.chemical_low_events
    (site_id, meter_id, went_low_at, wash_count_at_low)
    VALUES (p_site_id, p_meter_id, p_now, 0);

    RETURN json_build_object('event', 'went_low', 'counter', p_counter_value);

  ELSIF v_old_value > 0 AND p_counter_value = 0 THEN
    -- Confirm the reset with the last 3 readings before treating it as a
    -- real top-up, same debounce reasoning as the switch RPC above.
    SELECT count(*) INTO v_recent_positive_count FROM (
      SELECT value FROM public.readings
      WHERE meter_id = p_meter_id
      ORDER BY recorded_at DESC LIMIT 3
    ) recent WHERE value > 0;

    IF v_recent_positive_count > 0 THEN
      RETURN json_build_object('event', 'no_change', 'debounced', true);
    END IF;

    UPDATE public.chemical_state
    SET current_state = p_counter_value, last_updated_at = p_now
    WHERE meter_id = p_meter_id;

    UPDATE public.chemical_low_events
    SET topped_up_at = p_now, wash_count_at_low = 0, wash_count_at_topup = v_old_value
    WHERE id = (
      SELECT id FROM public.chemical_low_events
      WHERE site_id = p_site_id
        AND meter_id = p_meter_id
        AND topped_up_at IS NULL
      ORDER BY went_low_at DESC LIMIT 1
    );

    RETURN json_build_object('event', 'topped_up', 'washes_during_low', v_old_value);
  ELSE
    UPDATE public.chemical_state
    SET current_state = p_counter_value, last_updated_at = p_now
    WHERE meter_id = p_meter_id;
    RETURN json_build_object('event', 'no_change');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_chemical_counter_change(uuid, uuid, int, timestamptz) TO authenticated, anon;
