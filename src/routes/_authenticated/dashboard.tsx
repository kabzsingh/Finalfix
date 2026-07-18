import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth-context";
import { Activity, AlertTriangle, Droplets, Gauge, Radio, TrendingUp, MapPin, Loader2 } from "lucide-react";
import { Link } from "@tanstack/react-router";
import { ThemeToggle } from "@/components/app/ThemeToggle";

export const Route = createFileRoute("/_authenticated/dashboard")({
  component: DashboardPage,
});

interface SiteMetric {
  id: string;
  name: string;
  location: string | null;
  logo_url: string | null;
  online: boolean;
  wash_today: number;
  wash_total: number;
  fresh_today: number;
  chemicals_total: number;
  chemicals_low: number;
}

function DashboardPage() {
  const { user, loading: authLoading } = useAuth();
  const [sites, setSites] = useState<SiteMetric[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    loadDashboard();
  }, [authLoading]);

  const loadDashboard = async () => {
    try {
      // Check if user is admin
      const { data: adminCheck } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user?.id)
        .eq("role", "admin")
        .single();

      let siteIds: string[] = [];

      if (adminCheck) {
        // Admin: get all sites
        const { data: allSites } = await supabase
          .from("sites")
          .select("id");
        siteIds = (allSites || []).map((s: any) => s.id);
      } else {
        // Regular user: get only sites they have access to
        const { data: userSites } = await supabase
          .from("user_access")
          .select("site_id")
          .eq("user_id", user?.id);
        siteIds = (userSites || []).map((us: any) => us.site_id);
      }

      if (siteIds.length === 0) {
        setSites([]);
        setLoading(false);
        return;
      }

      const { data: sitesData } = await supabase
        .from("sites")
        .select("id, name, location, logo_url")
        .in("id", siteIds);

      if (!sitesData) {
        setSites([]);
        setLoading(false);
        return;
      }

      const metricsPromises = sitesData.map(async (site) => {
        const { data: latest } = await supabase
          .from("readings")
          .select("meter_id, value, recorded_at")
          .eq("site_id", site.id)
          .order("recorded_at", { ascending: false })
          .limit(50);

        const { data: meters } = await supabase
          .from("meters")
          .select("id, meter_type")
          .eq("site_id", site.id);

        let washToday = 0, washTotal = 0, freshToday = 0, chemLow = 0, chemTotal = 0;
        let lastSeen = "";

        const meterMap = new Map(meters?.map((m: any) => [m.id, m]) || []);
        const latestByMeter = new Map<string, any>();

        (latest || []).forEach((r: any) => {
          if (!latestByMeter.has(r.meter_id)) {
            latestByMeter.set(r.meter_id, r);
          }
          if (!lastSeen || r.recorded_at > lastSeen) lastSeen = r.recorded_at;
        });

        latestByMeter.forEach((r, meterId) => {
          const meter = meterMap.get(meterId);
          if (!meter) return;

          if (meter.meter_type === "wash") {
            washToday = Number(r.value);
            washTotal = Math.max(washTotal, Number(r.value));
          } else if (meter.meter_type === "fresh_water") {
            freshToday = Number(r.value);
          } else if (meter.meter_type === "chemical") {
            chemTotal++;
            if (Number(r.value) >= 1) chemLow++;
          }
        });

        const now = new Date().getTime();
        const lastSeenTime = lastSeen ? new Date(lastSeen).getTime() : 0;
        const online = now - lastSeenTime < 5 * 60 * 1000;

        return {
          id: site.id,
          name: site.name,
          location: site.location,
          logo_url: site.logo_url,
          online,
          wash_today: washToday,
          wash_total: washTotal,
          fresh_today: freshToday,
          chemicals_total: chemTotal,
          chemicals_low: chemLow,
        };
      });

      const results = await Promise.all(metricsPromises);
      setSites(results.sort((a, b) => a.name.localeCompare(b.name)));
    } catch (e) {
      console.error("Failed to load dashboard:", e);
    } finally {
      setLoading(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="h-10 w-48 bg-slate-200 rounded animate-pulse mb-8" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="h-64 bg-slate-100 rounded-lg animate-pulse" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-white">Operations Dashboard</h1>
          <p className="text-slate-400 mt-2">Real-time monitoring of all wash sites</p>
        </div>
        <ThemeToggle />
      </div>

      {/* Sites Grid */}
      {sites.length === 0 ? (
        <div className="text-center py-16 bg-slate-800 rounded-xl border border-slate-700">
          <p className="text-slate-400 text-lg">No sites configured yet</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {sites.map((site) => (
            <SiteCard key={site.id} site={site} />
          ))}
        </div>
      )}
    </div>
  );
}

function SiteCard({ site }: { site: SiteMetric }) {
  const chemicalHealthy = site.chemicals_total === 0 || site.chemicals_low === 0;

  return (
    <Link to="/sites/$siteId" params={{ siteId: site.id }}>
      <div className="group relative bg-slate-800 border border-slate-700 rounded-xl shadow-sm hover:shadow-md transition-all h-full cursor-pointer overflow-hidden">
        {/* Top bar with status */}
        <div className="absolute top-0 left-0 right-0 h-1 bg-slate-700">
          <div
            className={`h-full transition-all ${site.online ? "bg-emerald-500 w-full" : "bg-slate-600 w-1/4"}`}
          />
        </div>

        <div className="p-6 pt-8">
          {/* Header - No Logo */}
          <div className="mb-6">
            <h3 className="font-semibold text-white text-lg">{site.name}</h3>
            {site.location && (
              <div className="flex items-center gap-1 text-sm text-slate-400 mt-1">
                <MapPin className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="truncate">{site.location}</span>
              </div>
            )}
          </div>

          {/* Status Badge */}
          <div className="flex items-center gap-2 mb-6 text-sm">
            <Radio
              className={`h-3 w-3 ${
                site.online ? "text-emerald-500 fill-emerald-500" : "text-slate-500 fill-slate-500"
              }`}
            />
            <span className={site.online ? "text-emerald-400 font-medium" : "text-slate-400"}>
              {site.online ? "Live" : "Offline"}
            </span>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 gap-3 mb-6">
            {/* Wash Today */}
            <div className="bg-slate-700 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center gap-2 mb-2">
                <Gauge className="h-4 w-4 text-cyan-400" />
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Today</span>
              </div>
              <div className="text-2xl font-bold text-white">{site.wash_today}</div>
              <div className="text-xs text-slate-400 mt-1">washes</div>
            </div>

            {/* Lifetime */}
            <div className="bg-slate-700 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Total</span>
              </div>
              <div className="text-2xl font-bold text-white">{(site.wash_total / 1000).toFixed(1)}k</div>
              <div className="text-xs text-slate-400 mt-1">lifetime</div>
            </div>

            {/* Fresh Water */}
            <div className="bg-slate-700 rounded-lg p-4 border border-slate-600">
              <div className="flex items-center gap-2 mb-2">
                <Droplets className="h-4 w-4 text-cyan-400" />
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Fresh</span>
              </div>
              <div className="text-2xl font-bold text-white">{site.fresh_today.toFixed(0)}</div>
              <div className="text-xs text-cyan-400 mt-1">liters</div>
            </div>

            {/* Chemicals */}
            <div
              className={`rounded-lg p-4 border ${
                chemicalHealthy
                  ? "bg-slate-700 border-slate-600"
                  : "bg-amber-900 border-amber-700"
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                {chemicalHealthy ? (
                  <Activity className="h-4 w-4 text-cyan-400" />
                ) : (
                  <AlertTriangle className="h-4 w-4 text-amber-400" />
                )}
                <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wide">Chem</span>
              </div>
              <div className={`text-2xl font-bold ${chemicalHealthy ? "text-white" : "text-amber-100"}`}>
                {site.chemicals_total === 0 ? "—" : chemicalHealthy ? "✓" : site.chemicals_low}
              </div>
              <div className={`text-xs mt-1 ${chemicalHealthy ? "text-cyan-400" : "text-amber-400"}`}>
                {site.chemicals_total === 0
                  ? "no meters"
                  : chemicalHealthy
                  ? "all ok"
                  : `${site.chemicals_low} low`}
              </div>
            </div>
          </div>

          {/* View Details Link */}
          <div className="flex items-center justify-between text-sm font-medium text-slate-400 group-hover:text-cyan-400 transition-colors pt-4 border-t border-slate-700">
            <span className="mt-4">View details</span>
            <span className="text-lg group-hover:translate-x-1 transition-transform mt-4">→</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
