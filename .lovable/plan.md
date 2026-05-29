# Fix ESP32 readings + make dashboard live

## Problems

1. **Wash / water values too high.** Sketch uses `DEBOUNCE_MS = 5` for every pulse input. Reed-switch wash relays and mechanical water meters bounce for 20–80 ms, so each real pulse fires the ISR multiple times → counts inflated.
2. **Chemical-low signal arrives delayed / not showing.** Sketch only sends every `SEND_INTERVAL_MS = 30s`, and only the latest state at that moment. A transition can sit on the device for up to 30 s before the dashboard sees it.
3. **Dashboard isn't truly live.** It polls every 30 s and the realtime subscription depends on `readings` being in the `supabase_realtime` publication (not guaranteed). There's also no activity stream and "online" status is tiny.

## Fix plan

### 1. ESP32 sketch generator (`src/routes/_authenticated/admin.tsx` — `buildEsp32Sketch`)

- Use per-type debounce instead of a single 5 ms value:
  - `wash` → 50 ms (relay / contactor click)
  - `fresh_water` / `chemical_flow` → 25 ms (hall-effect flow sensors)
- Generate one `DEBOUNCE_<KEY>_MS` constant per meter and reference it in that meter's ISR.
- For chemical level meters: when the debounced `state_<k>` flips, mark a `levelDirty_<k> = true` flag and call `sendReadings()` immediately from `loop()` (in addition to the periodic 30 s send) so a Low/OK transition reaches the dashboard within a second.
- Shorten `SEND_INTERVAL_MS` to 15 s so dashboards stay fresh between event-driven sends.
- Add a wiring/debug comment block noting the new per-type debounce values.

### 2. Realtime publication (migration)

- `ALTER PUBLICATION supabase_realtime ADD TABLE public.readings;` (idempotent guard) so the existing `postgres_changes` subscriptions actually fire.

### 3. Live dashboard (`src/routes/_authenticated/dashboard.tsx`)

- Keep realtime subscription; drop the 30 s `setInterval` reload — instead, on each INSERT event, update the affected site card in place (increment today/total, refresh `last_seen`) without re-querying everything.
- Replace the small green dot with a prominent **Online / Offline + "last seen 4s ago"** pill that ticks every second using a shared "now" state.
- Add a new **Live activity feed** panel under the site grid: shows the last ~20 readings across all accessible sites (site name, meter name, value, "just now"). New rows slide in at the top via the realtime subscription, capped at 20.

### 4. Live site detail (`src/routes/_authenticated/sites.$siteId.tsx`)

- Same prominent online/last-seen pill in the header.
- Add a compact **Live readings** list (last 15 entries for that site) that prepends on realtime INSERT — useful for confirming the ESP32 is actually sending what you expect.
- Chemical state cards already react to the realtime subscription; no change needed once the publication is in place and the device pushes on transition.

## Technical notes

- Per-meter debounce is emitted alongside `pulseDecls` so each ISR compares against its own constant — no global change to existing logic.
- Event-driven chemical send uses a tiny rate-limit (min 2 s between forced sends) to avoid hammering the endpoint during contact chatter — the 250 ms `LEVEL_DEBOUNCE_MS` already filters real bounce.
- Activity feed stores rows in component state only (no schema change) and uses a `Map<site_id, meter_name>` lookup populated from the existing site/meter queries.
- After running the migration, the user must **re-download the sketch from Admin → Sketch and re-flash** the ESP32 for the debounce + event-push fixes to take effect.
