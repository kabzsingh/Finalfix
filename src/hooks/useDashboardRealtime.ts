import { useEffect, useCallback } from "react";
import { SupabaseClient } from "@supabase/supabase-js";

export function useDashboardRealtime(
  supabase: SupabaseClient,
  siteId: string,
  onUpdate: (newReading: any) => void
) {
  useEffect(() => {
    // Subscribe ONLY to readings for this site
    const channel = supabase
      .channel(`dashboard:${siteId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "readings",
          filter: `site_id=eq.${siteId}`,
        },
        (payload) => {
          onUpdate(payload.new);
        }
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          console.log(`✅ Subscribed to real-time updates for site ${siteId}`);
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [supabase, siteId, onUpdate]);
}
