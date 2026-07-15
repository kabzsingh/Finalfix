// Efficient queries that DON'T snowball
import { SupabaseClient } from "@supabase/supabase-js";

export async function getLatestReadingsForSite(
  supabase: SupabaseClient,
  siteId: string
) {
  // NEW: Use the function we created in database
  const { data, error } = await supabase.rpc(
    "get_latest_readings_for_site",
    { p_site_id: siteId }
  );
  
  if (error) throw error;
  return data || [];
}

export async function getTodayAndTotalForMeter(
  supabase: SupabaseClient,
  meterDeviceKey: string,
  siteId: string
) {
  // Get both total and today readings for a meter
  const { data, error } = await supabase
    .from("readings")
    .select("value, reading_type, recorded_at")
    .eq("site_id", siteId)
    .eq("meter_id", meterDeviceKey)
    .in("reading_type", ["total", "today"])
    .order("recorded_at", { ascending: false })
    .limit(2);  // Only need 2 (one total, one today)
  
  if (error) throw error;
  
  const result = {
    total: 0,
    today: 0,
    totalReadAt: null as string | null,
    todayReadAt: null as string | null,
  };
  
  for (const row of data || []) {
    if (row.reading_type === "total" && result.total === 0) {
      result.total = Number(row.value);
      result.totalReadAt = row.recorded_at;
    }
    if (row.reading_type === "today" && result.today === 0) {
      result.today = Number(row.value);
      result.todayReadAt = row.recorded_at;
    }
  }
  
  return result;
}

export async function getChemicalEvents(
  supabase: SupabaseClient,
  siteId: string,
  limit: number = 50
) {
  const { data, error } = await supabase.rpc(
    "get_chemical_events",
    { p_site_id: siteId, p_limit: limit }
  );
  
  if (error) throw error;
  return data || [];
}

export async function getChemicalCurrentStatus(
  supabase: SupabaseClient,
  siteId: string,
  chemicalDeviceKey: string  // e.g., "0004", "0005", "0006"
) {
  // Get latest level reading for chemical
  const { data, error } = await supabase
    .from("readings")
    .select("value, recorded_at")
    .eq("site_id", siteId)
    .eq("meter_id", chemicalDeviceKey)
    .eq("reading_type", "level")
    .order("recorded_at", { ascending: false })
    .limit(1);
  
  if (error) throw error;
  
  const reading = data?.[0];
  return {
    is_low: reading?.value === 0,  // 0 = low, 1 = ok
    level_value: reading?.value || 0,
    last_read_at: reading?.recorded_at || null,
  };
}
```

### Step 3: Update the dashboard.tsx component

Now update your dashboard to use these efficient queries:

Find the main load function in `dashboard.tsx` and replace it:

```typescript
// OLD: Loads entire history (SNOWBALLS)
// async function load() {
//   const { data: allWashReadings } = await supabase
//     .from("readings")
//     .select("*")
//     .in("meter_id", washMeterIds);  // ALL READINGS!
//   ...
// }

// NEW: Loads only latest values (EFFICIENT)
import { 
  getLatestReadingsForSite, 
  getTodayAndTotalForMeter,
  getChemicalCurrentStatus,
  getChemicalEvents 
} from "@/lib/dashboard-queries";

async function load() {
  const siteId = "YOUR_SITE_ID";  // Get from your context
  
  try {
    // Get all latest readings efficiently
    const allReadings = await getLatestReadingsForSite(supabase, siteId);
    
    // Extract wash data
    const washTotal = allReadings.find(r => r.device_key === "0001")?.value || 0;
    const washToday = allReadings.find(r => r.device_key === "0001_today")?.value || 0;
    
    // Extract water/rinse data
    const rinseTotal = allReadings.find(r => r.device_key === "0002")?.value || 0;
    const rinseToday = allReadings.find(r => r.device_key === "0002_today")?.value || 0;
    
    // Extract recycled/top-up data
    const recycleTotal = allReadings.find(r => r.device_key === "0003")?.value || 0;
    const recycleToday = allReadings.find(r => r.device_key === "0003_today")?.value || 0;
    
    // Get chemical levels
    const multicleanStatus = await getChemicalCurrentStatus(supabase, siteId, "0004");
    const autowashStatus = await getChemicalCurrentStatus(supabase, siteId, "0005");
    const waxStatus = await getChemicalCurrentStatus(supabase, siteId, "0006");
    
    // Get chemical events (for the history)
    const chemEvents = await getChemicalEvents(supabase, siteId);
    
    // Update state
    setWashCount({ total: washTotal, today: washToday });
    setRinseWater({ total: rinseTotal, today: rinseToday });
    setRecycled({ total: recycleTotal, today: recycleToday });
    
    setChemicalStatus({
      multiclean: multicleanStatus,
      autowash: autowashStatus,
      wax: waxStatus,
    });
    
    setChemicalEvents(chemEvents);
    
  } catch (error) {
    console.error("Failed to load dashboard:", error);
    setError(error instanceof Error ? error.message : "Load failed");
  }
}
