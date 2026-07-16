import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { ArrowLeft, Download, Filter } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { Link } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/chemical-report")({
  component: ChemicalReportPage,
});

interface ChemicalLowEvent {
  id: string;
  site_id: string;
  site_name: string;
  meter_id: string;
  meter_name: string;
  went_low_at: string;
  topped_up_at: string | null;
  wash_count_at_low: number;
  wash_count_at_topup: number | null;
  washes_during_low: number | null;
}

interface Site {
  id: string;
  name: string;
}

function ChemicalReportPage() {
  const [events, setEvents] = useState<ChemicalLowEvent[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [loading, setLoading] = useState(true);
  
  // Filters
  const [selectedSite, setSelectedSite] = useState<string>("all");
  const [selectedChemical, setSelectedChemical] = useState<string>("all");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");
  
  const uniqueChemicals = Array.from(new Set(events.map(e => e.meter_name)));

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      // Load sites
      const { data: sitesData, error: sitesErr } = await supabase
        .from("sites")
        .select("id,name")
        .order("name");
      if (sitesErr) throw sitesErr;
      setSites(sitesData || []);

      // Load chemical low events with site info
      const { data: eventsData, error: eventsErr } = await supabase
        .from("chemical_low_events")
        .select(`
          id,
          site_id,
          meter_id,
          went_low_at,
          topped_up_at,
          wash_count_at_low,
          wash_count_at_topup,
          washes_during_low,
          sites(name),
          site_meters(name)
        `)
        .order("went_low_at", { ascending: false })
        .limit(1000);
      
      if (eventsErr) throw eventsErr;

      const formatted = (eventsData || []).map((e: any) => ({
        id: e.id,
        site_id: e.site_id,
        site_name: e.sites?.name || "Unknown",
        meter_id: e.meter_id,
        meter_name: e.site_meters?.name || "Unknown",
        went_low_at: e.went_low_at,
        topped_up_at: e.topped_up_at,
        wash_count_at_low: e.wash_count_at_low || 0,
        wash_count_at_topup: e.wash_count_at_topup || 0,
        washes_during_low: e.washes_during_low || 0,
      }));

      setEvents(formatted);
    } catch (e: any) {
      toast.error(e.message || "Failed to load chemical events");
    } finally {
      setLoading(false);
    }
  };

  const filteredEvents = events.filter((e) => {
    if (selectedSite !== "all" && e.site_id !== selectedSite) return false;
    if (selectedChemical !== "all" && e.meter_name !== selectedChemical) return false;
    
    const eventDate = new Date(e.went_low_at);
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      if (eventDate < start) return false;
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      if (eventDate > end) return false;
    }
    
    return true;
  });

  const exportToCSV = () => {
    const headers = [
      "Site",
      "Chemical",
      "Went Low At",
      "Topped Up At",
      "Wash Count at Low",
      "Wash Count at Top-up",
      "Washes During Low",
      "Duration (hours)",
    ];

    const rows = filteredEvents.map((e) => {
      const lowDate = new Date(e.went_low_at);
      const topupDate = e.topped_up_at ? new Date(e.topped_up_at) : null;
      const durationHours = topupDate
        ? ((topupDate.getTime() - lowDate.getTime()) / (1000 * 60 * 60)).toFixed(2)
        : "Ongoing";

      return [
        e.site_name,
        e.meter_name,
        lowDate.toLocaleString(),
        topupDate ? topupDate.toLocaleString() : "Not topped up",
        e.wash_count_at_low,
        e.wash_count_at_topup || "-",
        e.washes_during_low || "-",
        durationHours,
      ];
    });

    const csv = [
      headers.join(","),
      ...rows.map((r) => r.map((cell) => `"${cell}"`).join(",")),
    ].join("\n");

    const blob = new Blob([csv], { type: "text/csv" });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `chemical-report-${new Date().toISOString().split("T")[0]}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
    toast.success("Report exported");
  };

  return (
    <div className="space-y-6 pb-20">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/dashboard">
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-semibold">Chemical Low Events Report</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Track when chemicals go low, how many washes occur before top-up, and duration
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="rounded-lg border border-border bg-card p-4 space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Filter className="h-4 w-4 text-muted-foreground" />
          <h2 className="text-sm font-semibold">Filters</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
          <div className="space-y-1">
            <Label className="text-xs">Site</Label>
            <Select value={selectedSite} onValueChange={setSelectedSite}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sites</SelectItem>
                {sites.map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">Chemical</Label>
            <Select value={selectedChemical} onValueChange={setSelectedChemical}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Chemicals</SelectItem>
                {uniqueChemicals.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              className="h-8 text-xs"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <div className="flex items-end">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs w-full"
              onClick={exportToCSV}
              disabled={filteredEvents.length === 0}
            >
              <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
            </Button>
          </div>
        </div>
      </div>

      {/* Results Summary */}
      <div className="text-sm text-muted-foreground">
        Showing <span className="font-semibold">{filteredEvents.length}</span> events
        {selectedSite !== "all" && ` in ${sites.find(s => s.id === selectedSite)?.name}`}
        {selectedChemical !== "all" && ` for ${selectedChemical}`}
      </div>

      {/* Table */}
      <div className="rounded-lg border border-border overflow-hidden bg-card">
        {loading ? (
          <div className="p-8 text-center text-muted-foreground">Loading...</div>
        ) : filteredEvents.length === 0 ? (
          <div className="p-8 text-center text-muted-foreground">
            No chemical low events found
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/30">
                <tr>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase text-muted-foreground">
                    Site
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase text-muted-foreground">
                    Chemical
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase text-muted-foreground">
                    Went Low
                  </th>
                  <th className="px-4 py-3 text-left font-semibold text-xs uppercase text-muted-foreground">
                    Topped Up
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-xs uppercase text-muted-foreground">
                    Washes at Low
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-xs uppercase text-muted-foreground">
                    Washes at Top-up
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-xs uppercase text-muted-foreground">
                    Washes During
                  </th>
                  <th className="px-4 py-3 text-center font-semibold text-xs uppercase text-muted-foreground">
                    Duration
                  </th>
                </tr>
              </thead>
              <tbody>
                {filteredEvents.map((event, idx) => {
                  const lowDate = new Date(event.went_low_at);
                  const topupDate = event.topped_up_at
                    ? new Date(event.topped_up_at)
                    : null;
                  const durationMs = topupDate
                    ? topupDate.getTime() - lowDate.getTime()
                    : null;
                  const durationHours = durationMs
                    ? (durationMs / (1000 * 60 * 60)).toFixed(2)
                    : null;
                  const durationDays = durationMs
                    ? (durationMs / (1000 * 60 * 60 * 24)).toFixed(1)
                    : null;

                  return (
                    <tr
                      key={event.id}
                      className={`border-b border-border transition-colors ${
                        idx % 2 === 0 ? "bg-background" : "bg-muted/20"
                      } hover:bg-muted/50`}
                    >
                      <td className="px-4 py-3 font-medium">{event.site_name}</td>
                      <td className="px-4 py-3">{event.meter_name}</td>
                      <td className="px-4 py-3 text-xs">
                        {lowDate.toLocaleString("en-US", {
                          month: "short",
                          day: "numeric",
                          year: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        {topupDate ? (
                          topupDate.toLocaleString("en-US", {
                            month: "short",
                            day: "numeric",
                            year: "numeric",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        ) : (
                          <span className="text-destructive font-semibold">
                            Not topped up
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold">
                        {event.wash_count_at_low}
                      </td>
                      <td className="px-4 py-3 text-center font-semibold">
                        {event.wash_count_at_topup || "-"}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span
                          className={`inline-block px-2 py-1 rounded font-semibold text-xs ${
                            event.washes_during_low
                              ? event.washes_during_low > 100
                                ? "bg-destructive/15 text-destructive"
                                : event.washes_during_low > 50
                                  ? "bg-warning/15 text-warning"
                                  : "bg-success/15 text-success"
                              : "text-muted-foreground"
                          }`}
                        >
                          {event.washes_during_low || "-"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center text-xs">
                        {durationHours ? `${durationHours}h (${durationDays}d)` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Statistics */}
      {filteredEvents.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground font-semibold mb-2">
              Total Low Events
            </div>
            <div className="text-3xl font-bold">{filteredEvents.length}</div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground font-semibold mb-2">
              Avg Washes During Low
            </div>
            <div className="text-3xl font-bold">
              {(
                filteredEvents.reduce((sum, e) => sum + (e.washes_during_low || 0), 0) /
                filteredEvents.length
              ).toFixed(0)}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground font-semibold mb-2">
              Max Washes During Low
            </div>
            <div className="text-3xl font-bold">
              {Math.max(...filteredEvents.map((e) => e.washes_during_low || 0))}
            </div>
          </div>

          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase text-muted-foreground font-semibold mb-2">
              Still Low
            </div>
            <div className="text-3xl font-bold text-destructive">
              {filteredEvents.filter((e) => !e.topped_up_at).length}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
