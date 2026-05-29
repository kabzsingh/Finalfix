import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Activity, Droplets, FlaskConical, Gauge, Plus, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth-context";

export const Route = createFileRoute("/_authenticated/dashboard")({ component: DashboardPage });

interface SiteOverview {
  id: string; name: string; location: string | null;
  wash_today: number; wash_total: number;
  fresh_today: number;
  chemicals_low: number; chemicals_total: number;
  last_seen: string | null;
}

interface MeterInfo {
  id: string;
  site_id: string;
  meter_type: "wash" | "fresh_water" | "chemical" | "chemical_flow";
  name: string;
  unit: string;
  low_threshold: number | null;
  capacity: number | null;
}

interface ActivityRow {
  id: string;
  site_id: string;
  site_name: string;
  meter_id: string;
  meter_name: string;
  meter_type: MeterInfo["meter_type"];
  unit: string;
  value: number;
  recorded_at: string;
}

function DashboardPage() {
  const { isAdmin } = useAuth();
  const [sites, setSites] = useState<SiteOverview[] | null>(null);
  const [meters, setMeters] = useState<MeterInfo[]>([]);
  const [activity, setActivity] = useState<ActivityRow[]>([]);
  const [now, setNow] = useState(() => Date.now());
  const metersRef = useRef<MeterInfo[]>([]);
  const sitesRef = useRef<SiteOverview[] | null>(null);
  useEffect(() => { metersRef.current = meters; }, [meters]);
  useEffect(() => { sitesRef.current = sites; }, [sites]);

  // ticking clock for "last seen" pills
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const load = async () => {
    const { data: siteRows } = await supabase
      .from("sites").select("id,name,location").order("name");
    if (!siteRows) { setSites([]); return; }

    const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);

    const { data: allMeters } = await supabase
      .from("site_meters")
      .select("id,site_id,meter_type,name,unit,capacity,low_threshold");
    setMeters((allMeters as any) ?? []);

    const overviews: SiteOverview[] = await Promise.all(siteRows.map(async (s) => {
      const meters = (allMeters ?? []).filter((m: any) => m.site_id === s.id);

      const meterIds = meters.map((m: any) => m.id);
      let washToday = 0, washTotal = 0, freshToday = 0, chemLow = 0, chemTotal = 0;
      let lastSeen: string | null = null;

      if (meterIds.length > 0) {
        const { data: latest } = await supabase
          .from("readings")
          .select("meter_id,value,recorded_at")
          .in("meter_id", meterIds)
          .order("recorded_at", { ascending: false })
          .limit(500);

        const latestByMeter = new Map<string, { value: number; recorded_at: string }>();
        (latest ?? []).forEach((r) => {
          if (!latestByMeter.has(r.meter_id)) latestByMeter.set(r.meter_id, { value: Number(r.value), recorded_at: r.recorded_at });
          if (!lastSeen || r.recorded_at > lastSeen) lastSeen = r.recorded_at;
        });

        for (const m of meters as any[]) {
          if (m.meter_type === "chemical") {
            chemTotal++;
            const v = latestByMeter.get(m.id)?.value;
            if (v !== undefined && Number(v) >= 1) chemLow++;
          }
        }

        const washMeterIds = (meters as any[]).filter((m) => m.meter_type === "wash").map((m) => m.id);
        const freshMeterIds = (meters as any[]).filter((m) => m.meter_type === "fresh_water").map((m) => m.id);

        if (washMeterIds.length > 0) {
          const { data: wt } = await supabase
            .from("readings").select("value")
            .in("meter_id", washMeterIds)
            .gte("recorded_at", startOfDay.toISOString());
          washToday = (wt ?? []).reduce((a, r) => a + Number(r.value), 0);
          const { data: wlt } = await supabase
            .from("readings").select("value")
            .in("meter_id", washMeterIds);
          washTotal = (wlt ?? []).reduce((a, r) => a + Number(r.value), 0);
        }
        if (freshMeterIds.length > 0) {
          const { data: ft } = await supabase
            .from("readings").select("value")
            .in("meter_id", freshMeterIds)
            .gte("recorded_at", startOfDay.toISOString());
          freshToday = (ft ?? []).reduce((a, r) => a + Number(r.value), 0);
        }
      }

      return {
        id: s.id, name: s.name, location: s.location,
        wash_today: washToday, wash_total: washTotal,
        fresh_today: freshToday,
        chemicals_low: chemLow, chemicals_total: chemTotal,
        last_seen: lastSeen,
      };
    }));

    setSites(overviews);
  };

  // Apply a new reading event to local state without re-fetching everything.
  const applyReading = (r: { meter_id: string; site_id: string; value: number; recorded_at: string }) => {
    const meter = metersRef.current.find((m) => m.id === r.meter_id);
    if (!meter) { load(); return; }

    const site = sitesRef.current?.find((s) => s.id === r.site_id);
    if (site) {
      setActivity((prev) => [{
        id: `${r.meter_id}-${r.recorded_at}-${Math.random().toString(36).slice(2,6)}`,
        site_id: r.site_id,
        site_name: site.name,
        meter_id: r.meter_id,
        meter_name: meter.name,
        meter_type: meter.meter_type,
        unit: meter.unit,
        value: Number(r.value),
        recorded_at: r.recorded_at,
      }, ...prev].slice(0, 25));
    }

    setSites((prev) => prev?.map((s) => {
      if (s.id !== r.site_id) return s;
      const next = { ...s, last_seen: r.recorded_at };
      const startOfDay = new Date(); startOfDay.setHours(0,0,0,0);
      const isToday = new Date(r.recorded_at) >= startOfDay;
      if (meter.meter_type === "wash") {
        next.wash_total = s.wash_total + Number(r.value);
        if (isToday) next.wash_today = s.wash_today + Number(r.value);
      } else if (meter.meter_type === "fresh_water") {
        if (isToday) next.fresh_today = s.fresh_today + Number(r.value);
      } else if (meter.meter_type === "chemical") {
        const isLow = Number(r.value) >= 1;
        const others = s.chemicals_low;
        next.chemicals_low = Math.min(s.chemicals_total, isLow ? Math.max(others, 1) : Math.max(0, others - 1));
        setTimeout(load, 250);
      }
      return next;
    }) ?? prev);
  };

  useEffect(() => {
    load();
    const ch = supabase.channel("readings-live")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "readings" }, (payload) => {
        const row = payload.new as any;
        applyReading({
          meter_id: row.meter_id,
          site_id: row.site_id,
          value: Number(row.value),
          recorded_at: row.recorded_at,
        });
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Live sites</h1>
          <p className="text-sm text-muted-foreground">Real-time view across all your wash sites.</p>
        </div>
        <Link to="/admin"><Button variant="outline" size="sm"><Plus className="h-4 w-4" /> Manage sites</Button></Link>
      </div>

      {sites === null ? (
        <div className="text-muted-foreground">Loading…</div>
      ) : sites.length === 0 ? (
        <EmptyState isAdmin={isAdmin} />
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {sites.map((s) => <SiteCard key={s.id} s={s} now={now} />)}
          </div>

          <ActivityFeed activity={activity} now={now} />
        </>
      )}
    </div>
  );
}

function formatAgo(ts: string | null, now: number): { label: string; online: boolean } {
  if (!ts) return { label: "never", online: false };
  const delta = Math.max(0, Math.floor((now - new Date(ts).getTime()) / 1000));
  const online = delta < 60;
  if (delta < 5) return { label: "just now", online };
  if (delta < 60) return { label: `${delta}s ago`, online };
  if (delta < 3600) return { label: `${Math.floor(delta/60)}m ago`, online };
  if (delta < 86400) return { label: `${Math.floor(delta/3600)}h ago`, online };
  return { label: `${Math.floor(delta/86400)}d ago`, online };
}

function SiteCard({ s, now }: { s: SiteOverview; now: number }) {
  const { label: lastSeenLabel, online } = formatAgo(s.last_seen, now);
  return (
    <Link to="/sites/$siteId" params={{ siteId: s.id }} className="group">
      <div className="rounded-xl border border-border bg-card p-5 shadow-card transition-all hover:border-primary/50 hover:shadow-glow">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="font-semibold truncate">{s.name}</div>
            {s.location && <div className="text-xs text-muted-foreground truncate">{s.location}</div>}
          </div>
          <div className={`shrink-0 px-2 py-1 rounded-md text-[11px] font-medium flex items-center gap-1.5 ${
            online ? "bg-success/15 text-success" : "bg-muted text-muted-foreground"
          }`}>
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-success animate-pulse" : "bg-muted-foreground/40"}`} />
            {online ? "Live" : "Offline"} · {lastSeenLabel}
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <Mini icon={Gauge} label="Today" value={s.wash_today.toLocaleString()} />
          <Mini icon={Activity} label="Lifetime" value={s.wash_total.toLocaleString()} />
          <Mini icon={Droplets} label="Fresh L" value={s.fresh_today.toFixed(0)} />
        </div>
        <div className="mt-3 text-xs flex items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" />
          {s.chemicals_total === 0 ? (
            <span className="text-muted-foreground">No chemical meters</span>
          ) : s.chemicals_low > 0 ? (
            <span className="text-destructive font-medium">{s.chemicals_low} of {s.chemicals_total} chemicals low</span>
          ) : (
            <span className="text-success">All {s.chemicals_total} chemicals healthy</span>
          )}
        </div>
      </div>
    </Link>
  );
}

function Mini({ icon: Icon, label, value }: { icon: typeof Gauge; label: string; value: string }) {
  return (
    <div className="rounded-md bg-secondary/60 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon className="h-3 w-3" />{label}
      </div>
      <div className="text-base font-semibold tabular-nums mt-0.5">{value}</div>
    </div>
  );
}

function ActivityFeed({ activity, now }: { activity: ActivityRow[]; now: number }) {
  return (
    <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Radio className="h-4 w-4 text-success animate-pulse" />
          <h2 className="font-semibold text-sm">Live activity</h2>
        </div>
        <span className="text-[11px] text-muted-foreground">{activity.length} recent event{activity.length === 1 ? "" : "s"}</span>
      </div>
      {activity.length === 0 ? (
        <div className="px-4 py-8 text-center text-sm text-muted-foreground">
          Waiting for incoming readings…
        </div>
      ) : (
        <ul className="divide-y divide-border max-h-80 overflow-y-auto">
          {activity.map((a) => {
            const { label } = formatAgo(a.recorded_at, now);
            const display = a.meter_type === "wash"
              ? `+${Math.round(a.value)} wash${Math.round(a.value) === 1 ? "" : "es"}`
              : a.meter_type === "fresh_water"
                ? `+${a.value.toFixed(1)} L`
                : a.meter_type === "chemical"
                  ? (Number(a.value) >= 1 ? "⚠ Chemical LOW" : "✓ Chemical OK")
                  : `+${a.value.toFixed(2)} ${a.unit}`;
            const tone = a.meter_type === "chemical"
              ? (Number(a.value) >= 1 ? "text-destructive" : "text-success")
              : "text-foreground";
            return (
              <li key={a.id} className="px-4 py-2.5 flex items-center justify-between gap-3 text-sm">
                <div className="min-w-0">
                  <div className="font-medium truncate">{a.site_name}</div>
                  <div className="text-xs text-muted-foreground truncate">{a.meter_name}</div>
                </div>
                <div className="text-right shrink-0">
                  <div className={`font-semibold tabular-nums ${tone}`}>{display}</div>
                  <div className="text-[11px] text-muted-foreground">{label}</div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ isAdmin }: { isAdmin: boolean }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/40 p-12 text-center">
      <div className="mx-auto h-12 w-12 rounded-xl bg-accent grid place-items-center mb-3">
        <Activity className="h-6 w-6 text-primary" />
      </div>
      <h3 className="font-semibold">No sites yet</h3>
      <p className="text-sm text-muted-foreground mt-1">
        {isAdmin ? "Create your first site and add meters to start streaming live data." : "Ask an admin to assign you to a site."}
      </p>
      {isAdmin && (
        <Link to="/admin" className="inline-block mt-4">
          <Button><Plus className="h-4 w-4" /> Create site</Button>
        </Link>
      )}
    </div>
  );
}
