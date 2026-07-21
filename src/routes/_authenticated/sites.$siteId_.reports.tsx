import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { Download, Calendar, TrendingUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/sites/$siteId_/reports")({
  component: SiteReportsPage,
});

function SiteReportsPage() {
  const { siteId } = Route.useParams() as { siteId: string };
  
  const [siteName, setSiteName] = useState("");
  const [reportType, setReportType] = useState<"daily" | "monthly">("daily");
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split("T")[0]);
  const [loading, setLoading] = useState(false);
  const [maxDaysBack, setMaxDaysBack] = useState(90);

  useEffect(() => {
    loadSiteInfo();
  }, [siteId]);

  const loadSiteInfo = async () => {
    try {
      const { data } = await supabase
        .from("sites")
        .select("name")
        .eq("id", siteId)
        .single();
      if (data) setSiteName(data.name);
    } catch (e) {
      console.error("Error loading site:", e);
    }
  };

  const fetchAllReadings = async (siteId: string, startISO: string, endISO: string) => {
    const pageSize = 1000;

    // First page also returns an ESTIMATED count (cheap — uses Postgres
    // planner statistics) so we know how many more pages to fetch, without
    // the cost of an EXACT count (a full table scan across every site's
    // readings, which can be slow enough on a large table to hang the request).
    const firstPage = await supabase
      .from("readings")
      .select("meter_id, value, recorded_at", { count: "estimated" })
      .eq("site_id", siteId)
      .gte("recorded_at", startISO)
      .lte("recorded_at", endISO)
      .order("recorded_at", { ascending: true })
      .range(0, pageSize - 1);
    if (firstPage.error) throw firstPage.error;

    let all: any[] = firstPage.data ?? [];
    const estimatedTotal = firstPage.count ?? all.length;

    if (all.length === pageSize && estimatedTotal > pageSize) {
      const pageCount = Math.ceil(estimatedTotal / pageSize) - 1;
      const pagePromises = Array.from({ length: pageCount }, (_, i) => {
        const from = (i + 1) * pageSize;
        return supabase
          .from("readings")
          .select("meter_id, value, recorded_at")
          .eq("site_id", siteId)
          .gte("recorded_at", startISO)
          .lte("recorded_at", endISO)
          .order("recorded_at", { ascending: true })
          .range(from, from + pageSize - 1);
      });
      const results = await Promise.all(pagePromises);
      for (const { data, error } of results) {
        if (error) throw error;
        if (data) all = all.concat(data);
      }

      // Estimated counts can drift from the real total. If the very last page
      // we fetched came back completely full, there may be more rows beyond
      // what the estimate suggested — keep fetching sequentially until a
      // partial (or empty) page confirms we've reached the end.
      let lastPageLen = results.length > 0 ? (results[results.length - 1].data?.length ?? 0) : firstPage.data?.length ?? 0;
      let nextFrom = pageCount * pageSize + pageSize;
      while (lastPageLen === pageSize) {
        const extra = await supabase
          .from("readings")
          .select("meter_id, value, recorded_at")
          .eq("site_id", siteId)
          .gte("recorded_at", startISO)
          .lte("recorded_at", endISO)
          .order("recorded_at", { ascending: true })
          .range(nextFrom, nextFrom + pageSize - 1);
        if (extra.error) throw extra.error;
        lastPageLen = extra.data?.length ?? 0;
        if (extra.data) all = all.concat(extra.data);
        nextFrom += pageSize;
      }
    }
    return all;
  };

  const generateReport = async () => {
    setLoading(true);
    try {
      await Promise.race([
        generateReportInner(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("Report generation timed out after 45s — try a shorter date range, or check your connection.")), 45000)
        ),
      ]);
    } catch (e: any) {
      console.error("Error generating report:", e);
      toast.error(e.message || "Failed to generate report");
    } finally {
      setLoading(false);
    }
  };

  const generateReportInner = async () => {
    // Get date range
    const reportDate = new Date(selectedDate);
    let startDate, endDate, fileName;

      if (reportType === "daily") {
        startDate = new Date(reportDate);
        startDate.setHours(0, 0, 0, 0);
        endDate = new Date(reportDate);
        endDate.setHours(23, 59, 59, 999);
        fileName = `${siteName}_Daily_Report_${selectedDate}.csv`;
      } else {
        // Monthly: first day to last day
        startDate = new Date(reportDate.getFullYear(), reportDate.getMonth(), 1);
        endDate = new Date(reportDate.getFullYear(), reportDate.getMonth() + 1, 0);
        endDate.setHours(23, 59, 59, 999);
        fileName = `${siteName}_Monthly_Report_${reportDate.getFullYear()}-${String(reportDate.getMonth() + 1).padStart(2, "0")}.csv`;
      }

      const { data: meters } = await supabase
        .from("site_meters")
        .select("id, name, meter_type, unit")
        .eq("site_id", siteId);

      const { data: chemicalEvents } = await supabase
        .from("chemical_low_events")
        .select("meter_id, went_low_at, topped_up_at, washes_during_low")
        .eq("site_id", siteId)
        .gte("went_low_at", startDate.toISOString())
        .lte("went_low_at", endDate.toISOString());

      // Build CSV
      let csv = `Wash Dashboard Report - ${siteName}\n`;
      csv += `Report Type: ${reportType === "daily" ? "Daily" : "Monthly"}\n`;
      csv += `Period: ${startDate.toLocaleDateString()} to ${endDate.toLocaleDateString()}\n`;
      csv += `Generated: ${new Date().toLocaleString()}\n\n`;

      if (reportType === "daily") {
        // A day's worth of readings is bounded (~30-40k rows for a busy site),
        // so a parallel paginated fetch is fine here.
        const readings = await fetchAllReadings(siteId, startDate.toISOString(), endDate.toISOString());
        csv += buildHourlyDailyCsv(meters || [], readings, startDate);
      } else {
        // A full month of raw 15-second readings could be 900,000+ rows — far
        // more than we need, since the report only needs the value at each
        // day's end. Fetch those specific points directly instead of the bulk data.
        csv += await buildDailyMonthlyCsv(meters || [], siteId, startDate, endDate);
      }

      // Chemical events section
      if (chemicalEvents && chemicalEvents.length > 0) {
        csv += `\nCHEMICAL FILL HISTORY\n`;
        csv += `Meter,Went Low,Topped Up,Washes Used\n`;
        (chemicalEvents || []).forEach((e: any) => {
          const meter = meters?.find((m: any) => m.id === e.meter_id);
          const toppedUp = e.topped_up_at ? new Date(e.topped_up_at).toLocaleString() : "Still low";
          const washesUsed = e.washes_during_low !== null ? e.washes_during_low : "—";
          csv += `"${meter?.name || "Unknown"}","${new Date(e.went_low_at).toLocaleString()}","${toppedUp}","${washesUsed}"\n`;
        });
      }

      // Download
      const blob = new Blob([csv], { type: "text/csv" });
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      a.click();
      window.URL.revokeObjectURL(url);

      toast.success(`Report downloaded: ${fileName}`);
  };

  // Get available dates for picker
  const getMaxDate = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return today.toISOString().split("T")[0];
  };

  const getMinDate = () => {
    const minDate = new Date();
    minDate.setDate(minDate.getDate() - maxDaysBack);
    minDate.setHours(0, 0, 0, 0);
    return minDate.toISOString().split("T")[0];
  };

  return (
    <div className="min-h-screen bg-background p-4 md:p-6">
      {/* Back Button */}
      <div className="mb-6">
        <button 
          onClick={() => window.history.back()}
          className="text-primary hover:underline flex items-center gap-2"
        >
          ← Back to Site
        </button>
      </div>

      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-foreground mb-2">Reports</h1>
        <p className="text-lg text-muted-foreground">{siteName}</p>
        <p className="text-sm text-muted-foreground mt-2">Download comprehensive data reports</p>
      </div>

      {/* Report Generator */}
      <Card className="p-6 space-y-6 max-w-2xl">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-2">Report Type</label>
            <div className="flex gap-2">
              <Button
                variant={reportType === "daily" ? "default" : "outline"}
                onClick={() => setReportType("daily")}
                className="flex-1 gap-2"
              >
                <Calendar className="h-4 w-4" />
                Daily Report
              </Button>
              <Button
                variant={reportType === "monthly" ? "default" : "outline"}
                onClick={() => setReportType("monthly")}
                className="flex-1 gap-2"
              >
                <TrendingUp className="h-4 w-4" />
                Monthly Report
              </Button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium mb-2">
              {reportType === "daily" ? "Select Date" : "Select Month"}
            </label>
            <input
              type={reportType === "daily" ? "date" : "month"}
              value={reportType === "daily" ? selectedDate : selectedDate.slice(0, 7)}
              onChange={(e) => {
                if (reportType === "daily") {
                  setSelectedDate(e.target.value);
                } else {
                  setSelectedDate(`${e.target.value}-01`);
                }
              }}
              min={getMinDate()}
              max={getMaxDate()}
              className="w-full px-4 py-2 rounded-lg border border-border bg-background text-foreground"
            />
            <p className="text-xs text-muted-foreground mt-1">
              Available: Last {maxDaysBack} days
            </p>
          </div>

          <div className="bg-muted/50 rounded-lg p-4">
            <h3 className="font-medium mb-2">Report Includes:</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              {reportType === "daily" ? (
                <>
                  <li>✓ Hour-by-hour breakdown (00:00–23:00)</li>
                  <li>✓ Daily and Total for wash counts and water meters</li>
                  <li>✓ Chemical status (OK/LOW) per hour</li>
                  <li>✓ Day summary + chemical level events</li>
                </>
              ) : (
                <>
                  <li>✓ Day-by-day breakdown for the month</li>
                  <li>✓ Daily and Total for wash counts and water meters</li>
                  <li>✓ Chemical status (OK/LOW) per day</li>
                  <li>✓ Month summary + chemical level events</li>
                </>
              )}
              <li>✓ Formatted as CSV (Excel compatible)</li>
            </ul>
          </div>

          <Button
            onClick={generateReport}
            disabled={loading}
            className="w-full gap-2 h-12 text-base"
            size="lg"
          >
            <Download className="h-5 w-5" />
            {loading ? "Generating..." : "Download Report"}
          </Button>
        </div>
      </Card>

      {/* Historical Reports */}
      <div className="mt-12">
        <h2 className="text-2xl font-bold mb-6">Quick Access</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Today */}
          <QuickReportButton
            label="Today"
            date={new Date()}
            type="daily"
            onDownload={() => {
              setReportType("daily");
              setSelectedDate(new Date().toISOString().split("T")[0]);
              setTimeout(() => generateReport(), 100);
            }}
            loading={loading}
          />

          {/* Yesterday */}
          <QuickReportButton
            label="Yesterday"
            date={new Date(Date.now() - 86400000)}
            type="daily"
            onDownload={() => {
              const yesterday = new Date(Date.now() - 86400000);
              setReportType("daily");
              setSelectedDate(yesterday.toISOString().split("T")[0]);
              setTimeout(() => generateReport(), 100);
            }}
            loading={loading}
          />

          {/* Last Week */}
          <QuickReportButton
            label="Last 7 Days"
            date={new Date(Date.now() - 604800000)}
            type="daily"
            onDownload={() => {
              const lastWeek = new Date(Date.now() - 604800000);
              setReportType("daily");
              setSelectedDate(lastWeek.toISOString().split("T")[0]);
              setTimeout(() => generateReport(), 100);
            }}
            loading={loading}
          />

          {/* This Month */}
          <QuickReportButton
            label="This Month"
            date={new Date()}
            type="monthly"
            onDownload={() => {
              setReportType("monthly");
              setSelectedDate(new Date().toISOString().split("T")[0]);
              setTimeout(() => generateReport(), 100);
            }}
            loading={loading}
          />

          {/* Last Month */}
          <QuickReportButton
            label="Last Month"
            date={new Date(new Date().setMonth(new Date().getMonth() - 1))}
            type="monthly"
            onDownload={() => {
              const lastMonth = new Date();
              lastMonth.setMonth(lastMonth.getMonth() - 1);
              setReportType("monthly");
              setSelectedDate(lastMonth.toISOString().split("T")[0]);
              setTimeout(() => generateReport(), 100);
            }}
            loading={loading}
          />

          {/* 2 Months Ago */}
          <QuickReportButton
            label="2 Months Ago"
            date={new Date(new Date().setMonth(new Date().getMonth() - 2))}
            type="monthly"
            onDownload={() => {
              const twoMonthsAgo = new Date();
              twoMonthsAgo.setMonth(twoMonthsAgo.getMonth() - 2);
              setReportType("monthly");
              setSelectedDate(twoMonthsAgo.toISOString().split("T")[0]);
              setTimeout(() => generateReport(), 100);
            }}
            loading={loading}
          />
        </div>
      </div>
    </div>
  );
}

function csvEscape(v: string | number) {
  return `"${String(v).replace(/"/g, '""')}"`;
}

// Builds an hour-by-hour table for a single day: one row per hour (00:00-23:00),
// with Daily (used since midnight) and Total (raw cumulative reading) columns
// for wash/fresh_water meters, and a chemical status column per chemical meter.
function buildHourlyDailyCsv(meters: any[], readings: any[], dayStart: Date) {
  const washFreshMeters = meters.filter((m) => m.meter_type === "wash" || m.meter_type === "fresh_water");
  const chemicalMeters = meters.filter((m) => m.meter_type === "chemical" || m.meter_type === "chemical_flow");

  // Group readings by meter, sorted ascending (readings arrive pre-sorted, but be defensive)
  const byMeter = new Map<string, any[]>();
  readings.forEach((r: any) => {
    if (!byMeter.has(r.meter_id)) byMeter.set(r.meter_id, []);
    byMeter.get(r.meter_id)!.push(r);
  });
  byMeter.forEach((arr) => arr.sort((a, b) => new Date(a.recorded_at).getTime() - new Date(b.recorded_at).getTime()));

  // Value of a meter at/just-before a given cutoff timestamp (carries forward the
  // last known reading; undefined if no reading exists yet at that point).
  const valueAt = (meterId: string, cutoff: Date): number | undefined => {
    const arr = byMeter.get(meterId);
    if (!arr || arr.length === 0) return undefined;
    let result: number | undefined;
    for (const r of arr) {
      if (new Date(r.recorded_at).getTime() <= cutoff.getTime()) {
        result = Number(r.value);
      } else break;
    }
    return result;
  };

  const midnightValue: Record<string, number> = {};
  washFreshMeters.forEach((m) => {
    midnightValue[m.id] = valueAt(m.id, dayStart) ?? 0;
  });

  // Header
  let csv = `HOURLY BREAKDOWN\n`;
  const headerCols = ["Hour"];
  washFreshMeters.forEach((m) => {
    headerCols.push(`${m.name} - Daily (${m.unit || (m.meter_type === "wash" ? "washes" : "")})`);
    headerCols.push(`${m.name} - Total (${m.unit || (m.meter_type === "wash" ? "washes" : "")})`);
  });
  chemicalMeters.forEach((m) => {
    headerCols.push(`${m.name} - Status`);
  });
  csv += headerCols.map(csvEscape).join(",") + "\n";

  const now = new Date();
  const isToday = dayStart.toDateString() === now.toDateString();
  const lastHour = isToday ? now.getHours() : 23;

  for (let h = 0; h <= lastHour; h++) {
    const cutoff = new Date(dayStart);
    cutoff.setHours(h, 59, 59, 999);
    const row: (string | number)[] = [`${String(h).padStart(2, "0")}:00`];

    washFreshMeters.forEach((m) => {
      const total = valueAt(m.id, cutoff);
      if (total === undefined) {
        row.push("—", "—");
      } else {
        const daily = Math.max(0, total - midnightValue[m.id]);
        row.push(daily, total);
      }
    });

    chemicalMeters.forEach((m) => {
      const state = valueAt(m.id, cutoff);
      row.push(state === undefined ? "—" : state >= 1 ? "LOW" : "OK");
    });

    csv += row.map(csvEscape).join(",") + "\n";
  }

  // Day summary
  csv += `\nDAY SUMMARY\n`;
  washFreshMeters.forEach((m) => {
    const total = valueAt(m.id, new Date(dayStart.getTime() + 24 * 3600 * 1000 - 1)) ?? midnightValue[m.id];
    const daily = Math.max(0, total - midnightValue[m.id]);
    csv += `${csvEscape(m.name)},"Daily: ${daily}, Total: ${total}"\n`;
  });
  chemicalMeters.forEach((m) => {
    const state = valueAt(m.id, new Date(dayStart.getTime() + 24 * 3600 * 1000 - 1));
    csv += `${csvEscape(m.name)},"${state === undefined ? "No data" : state >= 1 ? "LOW" : "OK"}"\n`;
  });

  return csv;
}

// Builds a day-by-day table for a month: one row per calendar day, with Daily
// (used that day) and Total (raw cumulative reading at end of day) columns for
// wash/fresh_water meters, and a chemical status column per chemical meter.
//
// Rather than downloading every raw reading for the month (which for 15-second
// interval data across several meters could be 900,000+ rows), this fetches
// only the single last reading at/before each day boundary, per meter — all in
// parallel — which is all the report actually needs.
async function buildDailyMonthlyCsv(meters: any[], siteId: string, monthStart: Date, monthEnd: Date) {
  const washFreshMeters = meters.filter((m) => m.meter_type === "wash" || m.meter_type === "fresh_water");
  const chemicalMeters = meters.filter((m) => m.meter_type === "chemical" || m.meter_type === "chemical_flow");
  const allMeters = [...washFreshMeters, ...chemicalMeters];

  const now = new Date();
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const isCurrentMonth = now.getFullYear() === monthStart.getFullYear() && now.getMonth() === monthStart.getMonth();
  const lastDay = isCurrentMonth ? now.getDate() : daysInMonth;

  const monthStartBoundary = new Date(monthStart);
  monthStartBoundary.setHours(0, 0, 0, 0);

  // One cutoff per day-end, plus a baseline cutoff just before the month starts.
  const cutoffs: Date[] = [new Date(monthStartBoundary.getTime() - 1)];
  for (let d = 1; d <= lastDay; d++) {
    const c = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
    c.setHours(23, 59, 59, 999);
    cutoffs.push(c);
  }

  // Fetch, for every (meter, cutoff) pair, the single last reading at/before
  // that cutoff — all requests fired in parallel.
  const pointQueries = allMeters.flatMap((m) =>
    cutoffs.map(async (cutoff) => {
      const { data, error } = await supabase
        .from("readings")
        .select("value, recorded_at")
        .eq("meter_id", m.id)
        .lte("recorded_at", cutoff.toISOString())
        .order("recorded_at", { ascending: false })
        .limit(1);
      if (error) throw error;
      return { meterId: m.id, cutoffTime: cutoff.getTime(), value: data && data.length > 0 ? Number(data[0].value) : undefined };
    })
  );
  const points = await Promise.all(pointQueries);

  const valueAtCutoff = new Map<string, number | undefined>();
  points.forEach((p) => valueAtCutoff.set(`${p.meterId}:${p.cutoffTime}`, p.value));
  const valueAt = (meterId: string, cutoff: Date) => valueAtCutoff.get(`${meterId}:${cutoff.getTime()}`);

  const baselineCutoff = cutoffs[0];
  const baseline: Record<string, number> = {};
  washFreshMeters.forEach((m) => {
    baseline[m.id] = valueAt(m.id, baselineCutoff) ?? 0;
  });

  let csv = `DAILY BREAKDOWN\n`;
  const headerCols = ["Date"];
  washFreshMeters.forEach((m) => {
    headerCols.push(`${m.name} - Daily (${m.unit || (m.meter_type === "wash" ? "washes" : "")})`);
    headerCols.push(`${m.name} - Total (${m.unit || (m.meter_type === "wash" ? "washes" : "")})`);
  });
  chemicalMeters.forEach((m) => {
    headerCols.push(`${m.name} - Status`);
  });
  csv += headerCols.map(csvEscape).join(",") + "\n";

  // Running "previous day total" per meter, starting from the baseline
  const prevTotal: Record<string, number> = { ...baseline };

  for (let d = 1; d <= lastDay; d++) {
    const dayDate = new Date(monthStart.getFullYear(), monthStart.getMonth(), d);
    const cutoff = cutoffs[d]; // cutoffs[0] is the baseline; day d's cutoff is at index d
    const row: (string | number)[] = [dayDate.toLocaleDateString()];

    washFreshMeters.forEach((m) => {
      const total = valueAt(m.id, cutoff);
      if (total === undefined) {
        row.push("—", "—");
      } else {
        const daily = Math.max(0, total - prevTotal[m.id]);
        row.push(daily, total);
        prevTotal[m.id] = total;
      }
    });

    chemicalMeters.forEach((m) => {
      const state = valueAt(m.id, cutoff);
      row.push(state === undefined ? "—" : state >= 1 ? "LOW" : "OK");
    });

    csv += row.map(csvEscape).join(",") + "\n";
  }

  // Month summary
  csv += `\nMONTH SUMMARY\n`;
  const monthEndCutoff = cutoffs[lastDay];
  washFreshMeters.forEach((m) => {
    const total = valueAt(m.id, monthEndCutoff) ?? baseline[m.id];
    const monthlyUsed = Math.max(0, total - baseline[m.id]);
    csv += `${csvEscape(m.name)},"Monthly: ${monthlyUsed}, Total: ${total}"\n`;
  });
  chemicalMeters.forEach((m) => {
    const state = valueAt(m.id, monthEndCutoff);
    csv += `${csvEscape(m.name)},"${state === undefined ? "No data" : state >= 1 ? "LOW" : "OK"}"\n`;
  });

  return csv;
}

function QuickReportButton({
  label,
  date,
  type,
  onDownload,
  loading,
}: {
  label: string;
  date: Date;
  type: "daily" | "monthly";
  onDownload: () => void;
  loading: boolean;
}) {
  return (
    <Card className="p-4 hover:border-primary/50 cursor-pointer transition-all" onClick={onDownload}>
      <div className="flex items-start justify-between">
        <div>
          <h3 className="font-medium">{label}</h3>
          <p className="text-xs text-muted-foreground mt-1">
            {type === "daily"
              ? date.toLocaleDateString()
              : new Date(date.getFullYear(), date.getMonth(), 1).toLocaleDateString("en-US", {
                  month: "long",
                  year: "numeric",
                })}
          </p>
        </div>
        <Download className="h-4 w-4 text-primary opacity-50 group-hover:opacity-100" />
      </div>
    </Card>
  );
}
