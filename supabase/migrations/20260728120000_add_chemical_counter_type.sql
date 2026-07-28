-- Adds a third chemical sensor_type: 'counter' — for PLCs that already
-- maintain a running "washes since chemical went low" count themselves
-- (incrementing by 1 per wash while low, resetting to 0 on top-up), rather
-- than a raw 0/1 switch. In this mode the incoming value directly IS the
-- washes-since-low count; no wash-meter delta reconstruction is needed.
alter table public.site_meters
  drop constraint if exists site_meters_sensor_type_check;

alter table public.site_meters
  add constraint site_meters_sensor_type_check check (sensor_type in ('switch', 'probe', 'counter'));

comment on column public.site_meters.sensor_type is
  'For chemical meters: "switch" = binary float switch (low/ok), "probe" = continuous level sensor, "counter" = PLC-maintained washes-since-low count (increments while low, resets to 0 on top-up). Ignored for non-chemical meter types.';

-- RPC for counter-type chemicals: mirrors handle_chemical_state_change but
-- reads/writes the actual counter value instead of a strict 0/1 state, and
-- derives washes_during_low directly from the counter's final value at
-- reset rather than from wash-meter deltas.
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
BEGIN
  SELECT current_state INTO v_old_value FROM public.chemical_state
  WHERE meter_id = p_meter_id;

  IF v_old_value IS NULL THEN
    v_old_value := 0;
    INSERT INTO public.chemical_state (meter_id, site_id, current_state, last_updated_at)
    VALUES (p_meter_id, p_site_id, p_counter_value, p_now)
    ON CONFLICT (meter_id) DO UPDATE SET current_state = p_counter_value, last_updated_at = p_now;
  ELSE
    UPDATE public.chemical_state
    SET current_state = p_counter_value, last_updated_at = p_now
    WHERE meter_id = p_meter_id;
  END IF;

  -- Went low: counter moved from 0 to a positive value.
  IF v_old_value = 0 AND p_counter_value > 0 THEN
    INSERT INTO public.chemical_low_events
    (site_id, meter_id, went_low_at, wash_count_at_low)
    VALUES (p_site_id, p_meter_id, p_now, 0);

    RETURN json_build_object('event', 'went_low', 'counter', p_counter_value);

  -- Topped up: counter reset back to 0 from a positive value. The final
  -- pre-reset value IS the washes-during-low count, so store it as
  -- wash_count_at_topup with wash_count_at_low fixed at 0 — the existing
  -- generated column (topup - low) then equals exactly that count.
  ELSIF v_old_value > 0 AND p_counter_value = 0 THEN
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
  END IF;

  RETURN json_build_object('event', 'no_change');
END;
$$;

GRANT EXECUTE ON FUNCTION public.handle_chemical_counter_change(uuid, uuid, int, timestamptz) TO authenticated, anon;
