import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Download, FileDown } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/reports")({ component: ReportsPage });

interface Site { id: string; name: string }
interface Meter { id: string; site_id: string; name: string; meter_type: "wash" | "fresh_water" | "chemical"; unit: string; device_key: string }

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

function ReportsPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [siteId, setSiteId] = useState<string>("");
  const [period, setPeriod] = useState<"daily" | "monthly">("daily");
  const today = new Date();
  const [day, setDay] = useState<string>(ymd(today));
  const [month, setMonth] = useState<string>(ym(today));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    supabase.from("sites").select("id,name").order("name").then(({ data }) => {
      const s = (data as Site[]) ?? [];
      setSites(s);
      if (s.length && !siteId) setSiteId(s[0].id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const generate = async () => {
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

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">Reports</h1>
        <p className="text-sm text-muted-foreground">Export daily or monthly CSV reports per site.</p>
      </div>

      <div className="rounded-xl border border-border bg-card p-5 shadow-card space-y-4">
        <div className="space-y-1.5">
          <Label>Site</Label>
          <Select value={siteId} onValueChange={setSiteId}>
            <SelectTrigger><SelectValue placeholder="Select a site" /></SelectTrigger>
            <SelectContent>
              {sites.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <Label>Period</Label>
          <Select value={period} onValueChange={(v) => setPeriod(v as "daily" | "monthly")}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="daily">Daily (hour-by-hour)</SelectItem>
              <SelectItem value="monthly">Monthly (day-by-day)</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {period === "daily" ? (
          <div className="space-y-1.5">
            <Label>Date</Label>
            <Input type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          </div>
        ) : (
          <div className="space-y-1.5">
            <Label>Month</Label>
            <Input type="month" value={month} onChange={(e) => setMonth(e.target.value)} />
          </div>
        )}

        <Button onClick={generate} disabled={busy} className="w-full sm:w-auto">
          {busy ? <><FileDown className="h-4 w-4 animate-pulse" /> Generating…</> : <><Download className="h-4 w-4" /> Download CSV</>}
        </Button>
      </div>

      <p className="text-xs text-muted-foreground">
        Wash &amp; water values are summed within each bucket. Chemical levels show the latest reading in each bucket.
      </p>
    </div>
  );
}