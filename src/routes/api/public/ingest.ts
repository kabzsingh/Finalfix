import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, type Env } from "@/lib/supabase";
import { getApiKeyByHash, getMetersForSite } from "@/lib/db";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { z } from "zod";

const PayloadSchema = z.object({
  readings: z.array(z.object({
    device_key: z.string().min(1).max(64),
    value: z.number().finite(),
    type: z.enum(['total', 'today', 'level', 'event']).default('total').optional(),
    recorded_at: z.string().datetime().optional(),
  })).min(1).max(200),
});

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, x-site-api-key, authorization",
  };
}

async function sha256(message: string) {
  const msgUint8 = new TextEncoder().encode(message);
  const cryptoObj = globalThis.crypto;
  if (!cryptoObj?.subtle) {
    throw new Error("Web Crypto Subtle API is not available.");
  }
  const hashBuffer = await cryptoObj.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const Route = createFileRoute("/api/public/ingest")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        const env = getRuntimeEnv() as unknown as Env;

        if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
          return json({ error: "Server configuration missing" }, 500);
        }

        const db = getSupabaseAdmin(env);

        const apiKey =
          request.headers.get("x-site-api-key") ||
          request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
        if (!apiKey) return json({ error: "Missing x-site-api-key" }, 401);

        const hash = await sha256(apiKey);

        let keyRow;
        try {
          keyRow = await getApiKeyByHash(db, hash);
        } catch (e: any) {
          if (e.code === 'PGRST116') return json({ error: "Invalid key" }, 401);
          return json({ error: e.message }, 500);
        }

        if (!keyRow || keyRow.revoked) return json({ error: "Invalid key" }, 401);

        let body: unknown;
        try { body = await request.json(); }
        catch { return json({ error: "Invalid JSON" }, 400); }

        const parsed = PayloadSchema.safeParse(body);
        if (!parsed.success) return json({ error: "Invalid payload", issues: parsed.error.flatten() }, 400);

        const meters = await getMetersForSite(db, keyRow.site_id);
        const map = new Map(meters.map((m) => [m.device_key, { id: m.id, type: m.meter_type }]));

        // ===== NEW: Process readings by type =====
        const readings: any[] = [];
        const chemicalEvents: any[] = [];
        const unknown: string[] = [];

        for (const r of parsed.data.readings) {
          const meterInfo = map.get(r.device_key);
          if (!meterInfo) { 
            unknown.push(r.device_key); 
            continue; 
          }

          if (r.type === 'event') {
            // Handle chemical event (low/topped up)
            // Example value: 1 means event occurred, 0 means no event
            if (r.value === 1) {
              chemicalEvents.push({
                device_key: r.device_key,
                meter_id: meterInfo.id,
                site_id: keyRow.site_id,
                recorded_at: r.recorded_at || new Date().toISOString(),
              });
            }
            continue;
          }

          // Regular reading (total, today, level)
          readings.push({
            site_id: keyRow.site_id,
            meter_id: meterInfo.id,
            value: r.value,
            reading_type: r.type || 'total',
            ...(r.recorded_at ? { recorded_at: r.recorded_at } : {}),
          });
        }

        if (readings.length === 0 && chemicalEvents.length === 0) {
          return json({ error: "No matching meters", unknown }, 400);
        }

        // Insert readings
        if (readings.length > 0) {
          const { error: insErr } = await db.from("readings").insert(readings);
          if (insErr) return json({ error: insErr.message }, 500);
        }

        // Process chemical events
        // TODO: Implement chemical event tracking based on ESP32 data
        if (chemicalEvents.length > 0) {
          console.log(`Received ${chemicalEvents.length} chemical events`);
          // Will implement in next step
        }

        await db.from("site_api_keys")
          .update({ last_used_at: new Date().toISOString() })
          .eq("key_hash", hash);

        return json({ 
          ok: true, 
          accepted: readings.length, 
          chemical_events: chemicalEvents.length,
          unknown 
        });
      },
    },
  },
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status, headers: { "Content-Type": "application/json", ...corsHeaders() },
  });
}
