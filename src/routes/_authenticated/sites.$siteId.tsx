import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Activity, Droplets, FlaskConical, Gauge, Pencil, Radio } from "lucide-react";
import { StatCard } from "@/components/app/StatCard";
import { MeterCard } from "@/components/app/MeterCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth-context";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sites/$siteId")({
  component: SiteDetail,
});

interface Meter {
  id: string;
  meter_type: "wash" | "fresh_water" | "chemical" | "chemical_flow";
  name: string;
  unit: string;
  capacity: number | null;
  low_threshold: number | null;
  device_key: string;
  chemical_group: string | null;
}
interface Reading {
  meter_id: string;
  value: number;
  recorded_at: string;
}

interface LiveEntry {
  id: string;
  meter_id: string;
  meter_name: string;
  meter_type: Meter["meter_type"];
  unit: string;
  value: number;
  recorded_at: string;
}

interface ChemLowEvent {
  meter_id: string;
  low_since: string;
}

function SiteDetail() {
  const { siteId } = Route.useParams();
  const [site, setSite] = useState<{ name: string; location: string | null } | null>(null);
  const [meters, setMeters] = useState<Meter[]>([]);
  const [readings, setReadings] = useState<Reading[]>([]);
  const [totals, setTotals] = useState<Record<string, number>>({});
  const [todays, setTodays] = useState<Record<string, number>>({});
  const [liveEntries, setLiveEntries] = useState<LiveEntry[]>([]);
  const [lastSeenTs, setLastSeenTs] = useState<string | null>(null);
  const [esp32LastSeen, setEsp32LastSeen] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [chemLowEvents, setChemLowEvents] = useState<ChemLowEvent[]>([]);
  // ADD these two new state lines + ref just below chemLowEvents:
  const [dayBaseline, setDayBaseline] = useState<Record<string, number>>({});
  const [washAtLow, setWashAtLow] = useState<Record<string, number>>({});
  const dayBaselineRef = useRef<Record<string, number>>({});
  useEffect(() => { dayBaselineRef.current = dayBaseline; }, [dayBaseline]);

  const metersRef = useRef<Meter[]>([]);
  useEffect(() => { metersRef.current = meters; }, [meters]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    const [{ data: s }, { data: m }, { data: apiKeys }] = await Promise.all([
      supabase.from("sites").select("name,location").eq("id", siteId).single(),
      supabase
        .from("site_meters")
        .select("id,meter_type,name,unit,capacity,low_threshold,device_key,position,chemical_group")
        .eq("site_id", siteId)
        .order("position"),
      supabase.from("site_api_keys").select("last_used_at").eq("site_id", siteId).order("last_used_at", { ascending: false }).limit(1),
    ]);
    setSite(s as any);
    const keyLastUsed = (apiKeys as any)?.[0]?.last_used_at ?? null;
    setEsp32LastSeen(keyLastUsed);
    setMeters((m as any) ?? []);

    const since = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
    // startOfDay is needed for several queries below — compute it once up-front
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const { data: r } = await supabase
      .from("readings")
      .select("meter_id,value,recorded_at")
      .eq("site_id", siteId)
      .gte("recorded_at", since)
      .order("recorded_at", { ascending: true })
      .limit(5000);
    const rows = (r as any) ?? [];
    setReadings(rows);

    // Find when each chemical meter went low
    const chemMeters = ((m as any) ?? []).filter((x: Meter) => x.meter_type === "chemical");
    const newLowEvents: ChemLowEvent[] = [];
    for (const cm of chemMeters) {
      const { data: chemReadings } = await supabase
        .from("readings")
        .select("value,recorded_at")
        .eq("meter_id", cm.id)
        .order("recorded_at", { ascending: false })
        .limit(200);
      const cr = (chemReadings ?? []) as { value: number; recorded_at: string }[];
      if (cr.length === 0) continue;
      const latest = cr[0];
      const isLow = Number(latest.value) >= 1;
      if (!isLow) continue;
      let lowSince = latest.recorded_at;
      for (let i = 1; i < cr.length; i++) {
        if (Number(cr[i].value) >= 1) {
          lowSince = cr[i].recorded_at;
        } else {
          break;
        }
      }
      newLowEvents.push({ meter_id: cm.id, low_since: lowSince });
    }
    setChemLowEvents(newLowEvents);
    // Find how many washes had occurred when each chemical went low
    const washMeter = ((m as any) ?? []).find((x: Meter) => x.meter_type === "wash");
    const newWashAtLow: Record<string, number> = {};
    if (washMeter) {
      for (const evt of newLowEvents) {
        const { data: wNearLow } = await supabase
          .from("readings")
          .select("value")
          .eq("meter_id", washMeter.id)
          .lte("recorded_at", evt.low_since)
          .order("recorded_at", { ascending: false })
          .limit(1);
        const wVal = (wNearLow as any)?.[0]?.value;
        if (wVal !== undefined) newWashAtLow[evt.meter_id] = Number(wVal);
      }
    }
    setWashAtLow(newWashAtLow);

    const seedMeters: Meter[] = (m as any) ?? [];
    const meterMap = new Map(seedMeters.map((x) => [x.id, x]));
    const seed = [...rows]
      .sort((a: Reading, b: Reading) => b.recorded_at.localeCompare(a.recorded_at))
      .slice(0, 15)
      .map((row: Reading, i: number) => {
        const mt = meterMap.get(row.meter_id);
        return {
          id: `seed-${i}-${row.meter_id}-${row.recorded_at}`,
          meter_id: row.meter_id,
          meter_name: mt?.name ?? "Unknown",
          meter_type: mt?.meter_type ?? "wash",
          unit: mt?.unit ?? "",
          value: Number(row.value),
          recorded_at: row.recorded_at,
        };
      });
    setLiveEntries(seed);
    if (rows.length > 0) setLastSeenTs(rows[rows.length - 1].recorded_at);

    // Fetch day-start baseline AND current latest value per absolute-counter meter.
    // Wash / fresh_water meters report a running counter (like an odometer), so
    // "today" = latest reading - reading at midnight, and "total" = latest reading.
    // (Summing raw readings, as we do for chemical_flow below, would double-count
    // the same counter value across every reading in the window.)
    const absMeters = ((m as any) ?? []).filter(
      (x: Meter) => x.meter_type === "wash" || x.meter_type === "fresh_water"
    );
    const newBaseline: Record<string, number> = {};
    const absTotals: Record<string, number> = {};
    for (const am of absMeters) {
      const [{ data: br }, { data: lr }] = await Promise.all([
        supabase
          .from("readings")
          .select("value")
          .eq("meter_id", am.id)
          .lt("recorded_at", startOfDay.toISOString())
          .order("recorded_at", { ascending: false })
          .limit(1),
        supabase
          .from("readings")
          .select("value")
          .eq("meter_id", am.id)
          .order("recorded_at", { ascending: false })
          .limit(1),
      ]);
      const bv = (br as any)?.[0]?.value;
      if (bv !== undefined) newBaseline[am.id] = Number(bv);
      const lv = (lr as any)?.[0]?.value;
      if (lv !== undefined) absTotals[am.id] = Number(lv);
    }
    setDayBaseline(newBaseline);

    // Chemical-flow meters report incremental deltas per reading, so summing is correct.
    const [{ data: sumSinceMidnight }, { data: allTime }] = await Promise.all([
      supabase.rpc("meter_totals_since", { _site_id: siteId, _since: startOfDay.toISOString() }),
      supabase.rpc("meter_totals", { _site_id: siteId }),
    ]);

    const todaysMap: Record<string, number> = {};
    const totalsMap: Record<string, number> = {};
    for (const row of (sumSinceMidnight as any[]) ?? []) todaysMap[row.meter_id] = Number(row.total) || 0;
    for (const row of (allTime as any[]) ?? []) totalsMap[row.meter_id] = Number(row.total) || 0;

    // Overwrite with correct counter-based math for wash / fresh_water meters.
    for (const am of absMeters) {
      const latest = absTotals[am.id];
      if (latest === undefined) continue;
      const baseline = newBaseline[am.id] ?? 0;
      totalsMap[am.id] = latest;
      todaysMap[am.id] = Math.max(0, latest - baseline);
    }

    setTodays(todaysMap);
    setTotals(totalsMap);
  };

  const applyRealtimeRow = (row: { meter_id: string; value: number; recorded_at: string }) => {
    const meter = metersRef.current.find((m) => m.id === row.meter_id);
    if (!meter) { load(); return; }

    const val = Number(row.value);
    const ts = row.recorded_at;

    setLiveEntries((prev) => [{
      id: `live-${row.meter_id}-${ts}-${Math.random().toString(36).slice(2, 6)}`,
      meter_id: row.meter_id,
      meter_name: meter.name,
      meter_type: meter.meter_type,
      unit: meter.unit,
      value: val,
      recorded_at: ts,
    }, ...prev].slice(0, 20));

    setLastSeenTs((prev) => (!prev || ts > prev) ? ts : prev);
    setEsp32LastSeen((prev) => (!prev || ts > prev) ? ts : prev);

    setReadings((prev) => {
      const cutoff = new Date(Date.now() - 24 * 60 * 60_000).toISOString();
      return [...prev.filter((r) => r.recorded_at >= cutoff), { meter_id: row.meter_id, value: val, recorded_at: ts }];
    });

    const startOfDay = new Date(); startOfDay.setHours(0, 0, 0, 0);
    const isToday = new Date(ts) >= startOfDay;
    if (isToday) {
      if (meter.meter_type === "wash" || meter.meter_type === "fresh_water") {
        // today = current absolute reading minus what it was at midnight
        const baseline = dayBaselineRef.current[row.meter_id] ?? 0;
        setTodays((prev) => ({
          ...prev,
          [row.meter_id]: Math.max(0, val - baseline),
        }));
      } else if (meter.meter_type === "chemical_flow") {
        setTodays((prev) => ({ ...prev, [row.meter_id]: (prev[row.meter_id] ?? 0) + val }));
      }
    }
    if (meter.meter_type === "wash" || meter.meter_type === "fresh_water") {
      // Absolute counters: total IS the latest reading — never add, just take max
      setTotals((prev) => ({ ...prev, [row.meter_id]: Math.max(prev[row.meter_id] ?? 0, val) }));
    } else if (meter.meter_type === "chemical_flow") {
      setTotals((prev) => ({ ...prev, [row.meter_id]: (prev[row.meter_id] ?? 0) + val }));
    }
    setTimeout(load, 150);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`site-${siteId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "readings", filter: `site_id=eq.${siteId}` },
        (payload) => {
          const row = payload.new as any;
          applyRealtimeRow({
            meter_id: row.meter_id,
            value: Number(row.value),
            recorded_at: row.recorded_at,
          });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  const stats = useMemo(() => {
    const latestByMeter = new Map<string, Reading>();
    for (const r of readings) {
      const meter = meters.find((m) => m.id === r.meter_id);
      if (!meter) continue;
      if (meter.meter_type === "chemical" || meter.meter_type === "chemical_flow") {
        const prev = latestByMeter.get(r.meter_id);
        if (!prev || prev.recorded_at < r.recorded_at) latestByMeter.set(r.meter_id, r);
      }
    }
    const sumBy = (type: Meter["meter_type"], src: Record<string, number>) =>
      meters.filter((m) => m.meter_type === type).reduce((s, m) => s + (src[m.id] ?? 0), 0);
    return {
      washToday: sumBy("wash", todays),
      washLifetime: sumBy("wash", totals),
      freshToday: sumBy("fresh_water", todays),
      freshLifetime: sumBy("fresh_water", totals),
      latestByMeter,
    };
  }, [readings, meters, totals, todays]);

  const chemicalLevelMeters = meters.filter((m) => m.meter_type === "chemical");
  const chemicalFlowMeters = meters.filter((m) => m.meter_type === "chemical_flow");
  const washMeters = meters.filter((m) => m.meter_type === "wash");
  const freshMeters = meters.filter((m) => m.meter_type === "fresh_water");

  const chemicalGroups = useMemo(() => {
    const groups = new Map<string, { label: string; level?: Meter; flow?: Meter }>();
    const push = (key: string, label: string, m: Meter) => {
      const g = groups.get(key) ?? { label };
      if (m.meter_type === "chemical") g.level = m;
      else if (m.meter_type === "chemical_flow") g.flow = m;
      groups.set(key, g);
    };
    for (const m of chemicalLevelMeters) push(m.chemical_group || `lvl:${m.id}`, m.chemical_group || m.name, m);
    for (const m of chemicalFlowMeters) push(m.chemical_group || `flw:${m.id}`, m.chemical_group || m.name, m);
    return Array.from(groups.values());
  }, [chemicalLevelMeters, chemicalFlowMeters]);

  if (!site) return <div className="text-muted-foreground">Loading…</div>;

  const bestTs = [esp32LastSeen, lastSeenTs].filter(Boolean).sort().reverse()[0] ?? null;
  const ago = bestTs ? Math.max(0, Math.floor((now - new Date(bestTs).getTime()) / 1000)) : null;
  const isOnline = ago !== null && ago < 90;
  const agoLabel = ago === null ? "never" :
    ago < 5 ? "just now" :
    ago < 60 ? `${ago}s ago` :
    ago < 3600 ? `${Math.floor(ago / 60)}m ago` :
    ago < 86400 ? `${Math.floor(ago / 3600)}h ago` :
    `${Math.floor(ago / 86400)}d ago`;

  const meterById = new Map(meters.map((m) => [m.id, m]));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to="/dashboard">
            <Button variant="ghost" size="icon">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">{site.name}</h1>
            {site.location && <p className="text-xs text-muted-foreground">{site.location}</p>}
          </div>
        </div>
        <div className={`px-3 py-1.5 rounded-md text-xs font-medium flex items-center gap-2 ${
          isOnline ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
        }`}>
          <span className={`h-2 w-2 rounded-full ${isOnline ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
          {isOnline ? "Live" : "Offline"} · last seen {agoLabel}
        </div>
      </div>

      {/* Stat cards — wash and water with today + lifetime */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={Gauge} label="Wash today" value={stats.washToday.toLocaleString()} />
        <StatCard icon={Activity} label="Wash total" value={stats.washLifetime.toLocaleString()} />
        <StatCard icon={Droplets} label="Water today" value={`${stats.freshToday.toFixed(1)} L`} />
        <StatCard icon={Droplets} label="Water total" value={`${stats.freshLifetime.toFixed(1)} L`} />
      </div>

      {washMeters.length > 1 || freshMeters.length > 1 ? (
        <div>
          <h2 className="text-lg font-semibold mb-4">Water Meters</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {washMeters.map((m) => (
              <div key={m.id} className="space-y-2">
                <MeterCard
                  name={m.name}
                  meterType="wash"
                  value={todays[m.id] ?? 0}
                  unit={m.unit}
                  capacity={m.capacity}
                  lowThreshold={m.low_threshold}
                  today={todays[m.id] ?? 0}
                  total={totals[m.id] ?? 0}
                />
                <AdminAdjust meterId={m.id} siteId={siteId} unit={m.unit} onSaved={load} />
              </div>
            ))}
            {freshMeters.map((m) => (
              <div key={m.id} className="space-y-2">
                <MeterCard
                  name={m.name}
                  meterType="fresh_water"
                  value={todays[m.id] ?? 0}
                  unit={m.unit}
                  capacity={m.capacity}
                  lowThreshold={m.low_threshold}
                  today={todays[m.id] ?? 0}
                  total={totals[m.id] ?? 0}
                />
                <AdminAdjust meterId={m.id} siteId={siteId} unit={m.unit} onSaved={load} />
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {/* Chemical levels */}
      <div>
        <h2 className="text-sm font-semibold mb-2 text-muted-foreground uppercase tracking-wide">Chemical levels</h2>
        {chemicalGroups.length === 0 ? (
          <div className="text-sm text-muted-foreground">No chemical meters configured.</div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {chemicalGroups.map((g, i) => {
              const lvl = g.level;
              const flw = g.flow;
              const flwLast = flw ? stats.latestByMeter.get(flw.id) : undefined;
              const flwToday = flw ? todays[flw.id] ?? 0 : 0;
              const flwTotal = flw ? totals[flw.id] ?? 0 : 0;
              const perWash = flw && stats.washToday > 0 ? flwToday / stats.washToday : null;

              let isLow = false;
              let washesSinceLow: number | null = null;
              let lowSinceLabel: string | null = null;

              if (lvl) {
                const lowEvent = chemLowEvents.find((e) => e.meter_id === lvl.id);
                isLow = !!lowEvent;

                if (isLow && lowEvent) {
                  washesSinceLow = readings
                    .filter((r) => {
                      const wm = meterById.get(r.meter_id);
                      return wm?.meter_type === "wash" && r.recorded_at >= lowEvent.low_since;
                    })
                    .reduce((s, r) => s + Number(r.value), 0);

                  const lowDelta = Math.floor((now - new Date(lowEvent.low_since).getTime()) / 1000);
                  lowSinceLabel = lowDelta < 60 ? "just now"
                    : lowDelta < 3600 ? `${Math.floor(lowDelta / 60)}m ago`
                    : lowDelta < 86400 ? `${Math.floor(lowDelta / 3600)}h ago`
                    : `${Math.floor(lowDelta / 86400)}d ago`;
                }
              }

              return (
                <div key={i} className="rounded-lg border border-border bg-card p-3 space-y-2">
                  <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide truncate">
                    {g.label}
                  </div>
                  {lvl ? (
                    isLow ? (
                      <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-3">
                        <div className="flex items-center justify-between">
                          <div className="text-sm font-semibold text-destructive">⚠ Chemical Low</div>
                          {lowSinceLabel && (
                            <div className="text-[11px] text-destructive/70">since {lowSinceLabel}</div>
                          )}
                        </div>
                        <div className="mt-1 text-xs text-muted-foreground">{lvl.name}</div>
                        <div className="mt-3 flex items-end gap-2">
                          <div className="text-3xl font-bold tabular-nums text-destructive">
                            {Math.round(washesSinceLow ?? 0).toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground pb-1">washes since low</div>
                        </div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 p-3">
                        <div className="text-sm font-semibold text-emerald-600 dark:text-emerald-400">✓ Chemical OK</div>
                        <div className="mt-1 text-xs text-muted-foreground">{lvl.name}</div>
                      </div>
                    )
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No level sensor</div>
                  )}
                  {flw ? (
                    <div className="rounded-lg border border-border bg-card/60 p-3">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium truncate">Flow — {flw.name}</span>
                        <span className="tabular-nums text-xs text-muted-foreground">
                          {(flwLast ? Number(flwLast.value) : 0).toFixed(2)} {flw.unit}
                        </span>
                      </div>
                      <div className="grid grid-cols-3 gap-2 mt-2 text-xs">
                        <div className="rounded bg-secondary/60 px-2 py-1">
                          <div className="text-muted-foreground">Today</div>
                          <div className="font-semibold tabular-nums">{flwToday.toFixed(2)} {flw.unit}</div>
                        </div>
                        <div className="rounded bg-secondary/60 px-2 py-1">
                          <div className="text-muted-foreground">Total</div>
                          <div className="font-semibold tabular-nums">{flwTotal.toFixed(2)} {flw.unit}</div>
                        </div>
                        <div className="rounded bg-secondary/60 px-2 py-1">
                          <div className="text-muted-foreground">Per wash</div>
                          <div className="font-semibold tabular-nums">
                            {perWash != null ? `${perWash.toFixed(2)} ${flw.unit}` : "—"}
                          </div>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">No flow meter</div>
                  )}
                  {flw ? <AdminAdjust meterId={flw.id} siteId={siteId} unit={flw.unit} onSaved={load} /> : null}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Live reading history */}
      <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <Radio className={`h-4 w-4 ${isOnline ? "text-success animate-pulse" : "text-muted-foreground/40"}`} />
            <h2 className="font-semibold text-sm">Live reading history</h2>
          </div>
          <span className="text-[11px] text-muted-foreground">last 20 events · updates in real-time</span>
        </div>
        {liveEntries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-muted-foreground">
            Waiting for incoming readings…
          </div>
        ) : (
          <ul className="divide-y divide-border max-h-72 overflow-y-auto">
            {liveEntries.map((entry) => {
              const delta = Math.max(0, Math.floor((now - new Date(entry.recorded_at).getTime()) / 1000));
              const lbl = delta < 5 ? "just now" : delta < 60 ? `${delta}s ago` : delta < 3600 ? `${Math.floor(delta / 60)}m ago` : `${Math.floor(delta / 3600)}h ago`;
              const val = entry.value;
              const display =
                entry.meter_type === "wash" ? `+${Math.round(val)} wash${Math.round(val) === 1 ? "" : "es"}` :
                entry.meter_type === "fresh_water" ? `+${val.toFixed(1)} L` :
                entry.meter_type === "chemical" ? (val >= 1 ? "⚠ Chemical LOW" : "✓ Chemical OK") :
                `+${val.toFixed(2)} ${entry.unit}`;
              const tone = entry.meter_type === "chemical"
                ? (val >= 1 ? "text-destructive" : "text-success")
                : "text-foreground";
              return (
                <li key={entry.id} className="px-4 py-2 flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <div className="font-medium truncate">{entry.meter_name}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-semibold tabular-nums ${tone}`}>{display}</div>
                    <div className="text-[11px] text-muted-foreground">{lbl}</div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function AdminAdjust({
  meterId,
  siteId,
  unit,
  onSaved,
}: {
  meterId: string;
  siteId: string;
  unit: string;
  onSaved: () => void;
}) {
  const { isAdmin } = useAuth();
  const [open, setOpen] = useState(false);
  const [val, setVal] = useState("");
  const [busy, setBusy] = useState(false);
  if (!isAdmin) return null;
  const submit = async () => {
    const n = Number(val);
    if (!Number.isFinite(n)) return toast.error("Enter a valid number");
    setBusy(true);
    const { error } = await supabase.from("readings").insert({
      site_id: siteId,
      meter_id: meterId,
      value: n,
      recorded_at: new Date().toISOString(),
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Reading saved");
    setVal("");
    setOpen(false);
    onSaved();
  };
  if (!open) {
    return (
      <Button variant="ghost" size="sm" className="w-full justify-center text-xs h-7" onClick={() => setOpen(true)}>
        <Pencil className="h-3 w-3" /> Adjust reading
      </Button>
    );
  }
  return (
    <div className="flex items-center gap-1.5">
      <Input
        autoFocus
        type="number"
        step="any"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder={`New value (${unit})`}
        className="h-8 text-xs"
      />
      <Button size="sm" className="h-8" onClick={submit} disabled={busy}>
        {busy ? "…" : "Save"}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8"
        onClick={() => { setOpen(false); setVal(""); }}
      >
        ×
      </Button>
    </div>
  );
}
