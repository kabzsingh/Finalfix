import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileDown, Beaker, Clock, AlertTriangle, CheckCircle2, Grid3x3, LayoutList } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsPage });

interface Site { id: string; name: string }
interface Meter { id: string; site_id: string; name: string; meter_type: "wash" | "fresh_water" | "chemical" | "chemical_flow"; unit: string; device_key: string }
interface ChemicalEvent {
  id: string;
  site_id: string;
  meter_id: string;
  meter_name?: string;
  went_low_at: string;
  topped_up_at: string | null;
  wash_count_at_low: number | null;
  wash_count_at_topup: number | null;
  washes_during_low: number;
}

function ymd(d: Date) { return d.toISOString().slice(0, 10); }
function ym(d: Date) { return d.toISOString().slice(0, 7); }

function toCsv(rows: (string | number)[][]): string {
  return rows.map((r) => r.map((c) => {
    const s = String(c ?? "");
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }).join(",")).join("\n");
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString();
}

function formatDuration(startIso: string, endIso: string | null): string {
  if (!endIso) return "Still low";
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  const ms = end - start;
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  return `${hours}h ${mins}m`;
}

function ReportsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [reportType, setReportType] = useState<"usage" | "chemical">("usage");
  const [chemicalViewMode, setChemicalViewMode] = useState<"table" | "cards">("cards");
  
  // Usage report state
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const today = new Date();
  const [day, setDay] = useState<string>(ymd(today));
  const [month, setMonth] = useState<string>(ym(today));
  
  // Chemical report state
  const [chemicalEvents, setChemicalEvents] = useState<ChemicalEvent[]>([]);
  const [chemStartDate, setChemStartDate] = useState<string>(ymd(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)));
  const [chemEndDate, setChemEndDate] = useState<string>(ymd(today));
  
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("sites").select("id,name").order("name").then(({ data }) => {
      const s = (data as Site[]) ?? [];
      setSites(s);
      if (s.length && !siteId) setSiteId(s[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fetch chemical events when site or dates change
  useEffect(() => {
    if (reportType !== "chemical" || !siteId) return;
    loadChemicalEvents();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, chemStartDate, chemEndDate, reportType]);

  const loadChemicalEvents = async () => {
    try {
      const startDate = new Date(`${chemStartDate}T00:00:00`).toISOString();
      const endDate = new Date(`${chemEndDate}T23:59:59`).toISOString();
      
      const { data, error } = await supabase
        .from("chemical_low_events")
        .select("id,site_id,meter_id,went_low_at,topped_up_at,wash_count_at_low,wash_count_at_topup,washes_during_low")
        .eq("site_id", siteId)
        .gte("went_low_at", startDate)
        .lte("went_low_at", endDate)
        .order("went_low_at", { ascending: false });
      
      if (error) throw error;
      
      // Fetch meter names
      const { data: meters } = await supabase
        .from("site_meters")
        .select("id,name")
        .eq("site_id", siteId);
      
      const meterMap = new Map((meters ?? []).map((m: any) => [m.id, m.name]));
      
      const eventsWithNames = (data ?? []).map((e: any) => ({
        ...e,
        meter_name: meterMap.get(e.meter_id) || "Unknown",
      }));
      
      setChemicalEvents(eventsWithNames);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to load chemical events");
    }
  };

  const generateUsageReport = async () => {
    if (!siteId) return toast.error("Pick a site");
    setBusy(true);
    try {
      const site = sites.find((s) => s.id === siteId)!;
      const { data: metersData, error: mErr } = await supabase
        .from("site_meters")
        .select("id,site_id,name,meter_type,unit,device_key")
        .eq("site_id", siteId)
        .order("position");
      if (mErr) throw mErr;
      const meters = (metersData as Meter[]) ?? [];
      if (meters.length === 0) { toast.error("No meters on this site"); return; }

      let from: Date, to: Date, label: string;
      if (period === "daily") {
        from = new Date(`${day}T00:00:00`);
        to = new Date(from); to.setDate(to.getDate() + 1);
        label = day;
      } else {
        const [y, m] = month.split("-").map(Number);
        from = new Date(y, m - 1, 1);
        to = new Date(y, m, 1);
        label = month;
      }

      // Fetch readings (paginate to bypass 1000-row limit)
      const meterIds = meters.map((m) => m.id);
      const all: { meter_id: string; value: number; recorded_at: string }[] = [];
      const PAGE = 1000;
      let offset = 0;
      while (true) {
        const { data, error } = await supabase
          .from("readings")
          .select("meter_id,value,recorded_at")
          .in("meter_id", meterIds)
          .gte("recorded_at", from.toISOString())
          .lt("recorded_at", to.toISOString())
          .order("recorded_at", { ascending: true })
          .range(offset, offset + PAGE - 1);
        if (error) throw error;
        const rows = data ?? [];
        all.push(...rows.map((r) => ({ meter_id: r.meter_id, value: Number(r.value), recorded_at: r.recorded_at })));
        if (rows.length < PAGE) break;
        offset += PAGE;
      }

      // Build buckets: daily report -> hourly buckets; monthly report -> daily buckets
      const buckets = new Map<string, Map<string, number>>(); // bucketKey -> meter_id -> sum
      const meterById = new Map(meters.map((m) => [m.id, m]));

      const bucketKey = (iso: string) => {
        const d = new Date(iso);
        if (period === "daily") {
          // hour bucket HH:00
          return `${String(d.getHours()).padStart(2, "0")}:00`;
        }
        return ymd(d);
      };

      for (const r of all) {
        const k = bucketKey(r.recorded_at);
        if (!buckets.has(k)) buckets.set(k, new Map());
        const inner = buckets.get(k)!;
        const m = meterById.get(r.meter_id);
        if (!m) continue;
        if (m.meter_type === "chemical") {
          // For chemicals, value = current level — take last reading in bucket
          inner.set(r.meter_id, r.value);
        } else {
          inner.set(r.meter_id, (inner.get(r.meter_id) ?? 0) + r.value);
        }
      }

      // Sorted bucket keys; for daily ensure all 24 hours appear
      let keys: string[];
      if (period === "daily") {
        keys = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
      } else {
        keys = [];
        const cur = new Date(from);
        while (cur < to) { keys.push(ymd(cur)); cur.setDate(cur.getDate() + 1); }
      }

      // Header
      const header = [period === "daily" ? "Hour" : "Date",
        ...meters.map((m) => `${m.name} (${m.unit || m.meter_type})`)];

      const rows: (string | number)[][] = [header];
      for (const k of keys) {
        const inner = buckets.get(k);
        const row: (string | number)[] = [k];
        for (const m of meters) {
          const v = inner?.get(m.id);
          row.push(v === undefined ? "" : Number(v.toFixed(3)));
        }
        rows.push(row);
      }

      // Totals row (sum for wash/fresh; latest already shown for chemicals — leave blank)
      const totals: (string | number)[] = ["Total"];
      for (const m of meters) {
        if (m.meter_type === "chemical") { totals.push(""); continue; }
        let sum = 0;
        for (const k of keys) {
          const v = buckets.get(k)?.get(m.id);
          if (typeof v === "number") sum += v;
        }
        totals.push(Number(sum.toFixed(3)));
      }
      rows.push(totals);

      const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
      downloadCsv(`${safeName}_${period}_${label}.csv`, toCsv(rows));
      toast.success("Report downloaded");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to generate report");
    } finally {
      setBusy(false);
    }
  };

  const downloadChemicalReport = async () => {
    if (!siteId || chemicalEvents.length === 0) {
      toast.error("No chemical events to export");
      return;
    }
    try {
      const site = sites.find((s) => s.id === siteId)!;
      const header = [
        "Chemical",
        "Went Low At",
        "Topped Up At",
        "Duration",
        "Washes at Low",
        "Washes at Top-up",
        "Washes During Low",
      ];
      
      const rows: (string | number)[][] = [header];
      for (const evt of chemicalEvents) {
        rows.push([
          evt.meter_name || "Unknown",
          formatDateTime(evt.went_low_at),
          evt.topped_up_at ? formatDateTime(evt.topped_up_at) : "Still low",
          formatDuration(evt.went_low_at, evt.topped_up_at),
          evt.wash_count_at_low ?? "-",
          evt.wash_count_at_topup ?? "-",
          evt.washes_during_low,
        ]);
      }
      
      const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
      downloadCsv(`${safeName}_chemical_events_${chemStartDate}_to_${chemEndDate}.csv`, toCsv(rows));
      toast.success("Chemical report exported");
    } catch (e: any) {
      toast.error(e.message ?? "Failed to export report");
    }
  };

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold tracking-tight text-slate-900">Reports</h1>
        <p className="text-slate-600 mt-2">Download comprehensive data reports for your sites.</p>
      </div>

      {/* Report Type Tabs */}
      <div className="flex gap-0 border-b border-slate-200 mb-8">
        <button
          onClick={() => setReportType("usage")}
          className={`px-4 py-3 font-semibold text-sm border-b-2 transition-colors ${
            reportType === "usage"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Download className="inline h-4 w-4 mr-2" />
          Usage Report
        </button>
        <button
          onClick={() => setReportType("chemical")}
          className={`px-4 py-3 font-semibold text-sm border-b-2 transition-colors flex items-center gap-2 ${
            reportType === "chemical"
              ? "border-blue-500 text-blue-600"
              : "border-transparent text-slate-500 hover:text-slate-700"
          }`}
        >
          <Beaker className="h-4 w-4" />
          Chemical Events
        </button>
      </div>

      {/* Usage Report Tab */}
      {reportType === "usage" && (
        <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6 max-w-2xl">
          <div className="space-y-6">
            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Site</Label>
              <Select value={siteId} onValueChange={setSiteId}>
                <SelectTrigger className="bg-white border-slate-200"><SelectValue placeholder="Select a site" /></SelectTrigger>
                <SelectContent>
                  {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label className="text-sm font-semibold text-slate-700">Period</Label>
              <Select value={period} onValueChange={(v) => setPeriod(v as "daily" | "monthly")}>
                <SelectTrigger className="bg-white border-slate-200"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="daily">Daily (hour-by-hour)</SelectItem>
                  <SelectItem value="monthly">Monthly (day-by-day)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {period === "daily" ? (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Date</Label>
                <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} className="bg-white border-slate-200" />
              </div>
            ) : (
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Month</Label>
                <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="bg-white border-slate-200" />
              </div>
            )}

            <Button onClick={generateUsageReport} disabled={busy} className="w-full bg-blue-500 hover:bg-blue-600 text-white font-semibold h-10">
              {busy ? <><FileDown className="h-4 w-4 animate-pulse mr-2" /> Generating…</> : <><Download className="h-4 w-4 mr-2" /> Download CSV</>}
            </Button>

            <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded-lg">
              Wash & water values are summed within each bucket. Chemical levels show the latest reading in each bucket.
            </p>
          </div>
        </div>
      )}

      {/* Chemical Events Tab */}
      {reportType === "chemical" && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg border border-slate-200 shadow-sm p-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Site</Label>
                <Select value={siteId} onValueChange={setSiteId}>
                  <SelectTrigger className="bg-white border-slate-200"><SelectValue placeholder="Select a site" /></SelectTrigger>
                  <SelectContent>
                    {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">Start Date</Label>
                <Input type="date" value={chemStartDate} onChange={(e) => setChemStartDate(e.target.value)} className="bg-white border-slate-200" />
              </div>

              <div className="space-y-2">
                <Label className="text-sm font-semibold text-slate-700">End Date</Label>
                <Input type="date" value={chemEndDate} onChange={(e) => setChemEndDate(e.target.value)} className="bg-white border-slate-200" />
              </div>
            </div>

            {chemicalEvents.length > 0 && (
              <div className="flex gap-2 items-center pt-4 border-t border-slate-200">
                <Button onClick={downloadChemicalReport} className="bg-blue-500 hover:bg-blue-600 text-white font-semibold">
                  <Download className="h-4 w-4 mr-2" /> Export CSV
                </Button>
                <div className="flex gap-1 border border-slate-200 rounded-lg p-1 bg-slate-50">
                  <button
                    onClick={() => setChemicalViewMode("cards")}
                    className={`p-2 rounded transition-colors ${
                      chemicalViewMode === "cards"
                        ? "bg-blue-500 text-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    title="Card view"
                  >
                    <Grid3x3 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setChemicalViewMode("table")}
                    className={`p-2 rounded transition-colors ${
                      chemicalViewMode === "table"
                        ? "bg-blue-500 text-white"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                    title="Table view"
                  >
                    <LayoutList className="h-4 w-4" />
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Chemical Events - Card View (Timeline) */}
          {chemicalViewMode === "cards" && chemicalEvents.length > 0 ? (
            <div className="space-y-4">
              <div className="text-sm font-semibold text-slate-700 px-1">
                {chemicalEvents.length} event{chemicalEvents.length === 1 ? "" : "s"}
              </div>
              {chemicalEvents.map((evt) => {
                const isStillLow = !evt.topped_up_at;
                return (
                  <div
                    key={evt.id}
                    className={`rounded-lg border-l-4 p-4 ${
                      isStillLow
                        ? "border-l-amber-500 bg-amber-50 border border-amber-100"
                        : "border-l-emerald-500 bg-emerald-50 border border-emerald-100"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-4 mb-3">
                      <div className="flex-1">
                        <h4 className="font-semibold text-slate-900 text-base mb-2">{evt.meter_name}</h4>
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-1 rounded ${
                            isStillLow
                              ? "bg-amber-200 text-amber-900"
                              : "bg-emerald-200 text-emerald-900"
                          }`}>
                            {isStillLow ? (
                              <>
                                <AlertTriangle className="h-3 w-3" />
                                STILL LOW
                              </>
                            ) : (
                              <>
                                <CheckCircle2 className="h-3 w-3" />
                                RESOLVED
                              </>
                            )}
                          </span>
                          <span className={`text-xs font-medium ${isStillLow ? "text-amber-700" : "text-emerald-700"}`}>
                            {formatDuration(evt.went_low_at, evt.topped_up_at)}
                          </span>
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-3 border-t border-slate-200">
                      <div className="space-y-1">
                        <div className="text-xs text-slate-600 font-medium uppercase tracking-wide">Went Low</div>
                        <div className="text-sm font-semibold text-slate-900">{new Date(evt.went_low_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-slate-600 font-medium uppercase tracking-wide">Topped</div>
                        <div className="text-sm font-semibold text-slate-900">
                          {evt.topped_up_at ? new Date(evt.topped_up_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : "Pending"}
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-slate-600 font-medium uppercase tracking-wide">At Low</div>
                        <div className="text-sm font-mono font-bold text-slate-900">{evt.wash_count_at_low ?? "-"}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-slate-600 font-medium uppercase tracking-wide">During</div>
                        <div className="text-sm font-mono font-bold text-blue-600">{evt.washes_during_low}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : chemicalViewMode === "table" && chemicalEvents.length > 0 ? (
            <div className="rounded-xl border border-border bg-card shadow-card overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 border-b border-border">
                    <tr>
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Chemical</th>
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Went Low</th>
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Topped Up</th>
                      <th className="px-4 py-3 text-left font-semibold text-muted-foreground">Duration</th>
                      <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Washes (Low)</th>
                      <th className="px-4 py-3 text-right font-semibold text-muted-foreground">Washes (Refill)</th>
                      <th className="px-4 py-3 text-right font-semibold text-muted-foreground">During Low</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {chemicalEvents.map((evt) => (
                      <tr key={evt.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 font-medium">{evt.meter_name}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">{formatDateTime(evt.went_low_at)}</td>
                        <td className="px-4 py-3 text-muted-foreground text-xs">
                          {evt.topped_up_at ? formatDateTime(evt.topped_up_at) : <span className="text-amber-600 font-medium">Still low</span>}
                        </td>
                        <td className="px-4 py-3 text-muted-foreground">
                          <span className={evt.topped_up_at ? "text-foreground" : "text-amber-600 font-medium"}>
                            {formatDuration(evt.went_low_at, evt.topped_up_at)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">{evt.wash_count_at_low ?? "-"}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{evt.wash_count_at_topup ?? "-"}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-medium">{evt.washes_during_low}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="px-4 py-3 bg-muted/30 border-t border-border text-xs text-muted-foreground">
                {chemicalEvents.length} event{chemicalEvents.length === 1 ? "" : "s"} in this period
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-border bg-muted/10 p-8 text-center">
              <Beaker className="h-8 w-8 text-muted-foreground/40 mx-auto mb-2" />
              <p className="text-muted-foreground text-sm">No chemical events in this period</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}