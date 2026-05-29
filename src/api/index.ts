import { getSupabase, getSupabaseAdmin, type Env } from "../lib/supabase";
import {
  getSites, getSiteById, createSite, updateSite, deleteSite,
  getMetersForSite, createMeter, updateMeter, deleteMeter,
  getApiKeyByHash, getApiKeysForSite, createApiKey, deleteApiKey,
  insertReadings, getReadingsForSite, getLatestReading,
  getSmtpSettings, upsertSmtpSettings,
  logReport, getReportLog,
} from "../lib/db";

/**
 * Robust SHA-256 hashing using Web Crypto API (native in Cloudflare Workers)
 */
async function sha256(message: string) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function handleApiRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;
  const method = request.method;

  // Handle CORS preflight
  if (method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, x-site-api-key, X-API-Key, Authorization",
      },
    });
  }

  try {
    // ── ESP32: Heartbeat / ping ─────────────────────────
    // POST /api/ping  — ESP32 sends this every ~30s to prove it's alive.
    // Updates last_used_at on the API key without inserting any readings.
    if (path === "/api/ping" && method === "POST") {
      const apiKey = request.headers.get("x-site-api-key") || request.headers.get("X-API-Key");
      if (!apiKey) return json({ error: "Missing API key" }, 401);
      const admin = getSupabaseAdmin(env);
      const hash = await sha256(apiKey);
      let keyData;
      try { keyData = await getApiKeyByHash(admin, hash); } catch { return json({ error: "Invalid API key" }, 403); }
      if (!keyData || keyData.revoked) return json({ error: "Invalid API key" }, 403);
      await admin.from("site_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", keyData.id);
      return json({ ok: true, site_id: keyData.site_id });
    }

    // ── ESP32: Ingest sensor data ───────────────────────
    // POST /api/readings
    if (path === "/api/readings" && method === "POST") {
      const apiKey = request.headers.get("x-site-api-key") || request.headers.get("X-API-Key");
      if (!apiKey) return json({ error: "Missing API key" }, 401);

      const admin = getSupabaseAdmin(env);
      const hash = await sha256(apiKey);

      let keyData;
      try {
        keyData = await getApiKeyByHash(admin, hash);
      } catch (e) {
        return json({ error: "Invalid API key" }, 403);
      }

      if (!keyData || keyData.revoked) return json({ error: "Invalid API key" }, 403);

      const body = await request.json() as any;
      // Support both single reading and batch array
      const readingsPayload = Array.isArray(body.readings) ? body.readings : [body];

      // Map device_keys from ESP32 to internal meter IDs
      const meters = await getMetersForSite(admin, keyData.site_id);
      const meterMap = new Map(meters.map((m) => [m.device_key, m.id]));

      const rows: any[] = [];
      const unknownKeys: string[] = [];

      for (const r of readingsPayload) {
        const meterId = meterMap.get(r.device_key);
        if (meterId) {
          rows.push({
            site_id: keyData.site_id,
            meter_id: meterId,
            value: r.value,
            recorded_at: r.recorded_at || new Date().toISOString()
          });
        } else {
          unknownKeys.push(r.device_key);
        }
      }

      if (rows.length === 0) {
        return json({ error: "No matching meters found for provided keys", unknown: unknownKeys }, 400);
      }

      const inserted = await insertReadings(admin, rows);

      // Update last used timestamp for the security key
      await admin.from("site_api_keys")
        .update({ last_used_at: new Date().toISOString() })
        .eq("id", keyData.id);

      return json({ success: true, count: inserted.length, unknown: unknownKeys }, 201);
    }

    // ── Sites ───────────────────────────────────────────
    if (path === "/api/sites" && method === "GET") {
      const db = getSupabase(env);
      return json(await getSites(db));
    }

    if (path === "/api/sites" && method === "POST") {
      const db = getSupabaseAdmin(env);
      return json(await createSite(db, await request.json()), 201);
    }

    const siteMatch = path.match(/^\/api\/sites\/([^/]+)$/);
    if (siteMatch) {
      const siteId = siteMatch[1];
      if (method === "GET") return json(await getSiteById(getSupabase(env), siteId));
      if (method === "PUT") return json(await updateSite(getSupabaseAdmin(env), siteId, await request.json()));
      if (method === "DELETE") {
        await deleteSite(getSupabaseAdmin(env), siteId);
        return json({ success: true });
      }
    }

    // ── Meters ──────────────────────────────────────────
    const siteMetersMatch = path.match(/^\/api\/sites\/([^/]+)\/meters$/);
    if (siteMetersMatch) {
      const siteId = siteMetersMatch[1];
      if (method === "GET") return json(await getMetersForSite(getSupabase(env), siteId));
      if (method === "POST") return json(await createMeter(getSupabaseAdmin(env), { site_id: siteId, ...await request.json() }), 201);
    }

    const meterMatch = path.match(/^\/api\/meters\/([^/]+)$/);
    if (meterMatch) {
      const meterId = meterMatch[1];
      if (method === "PUT") return json(await updateMeter(getSupabaseAdmin(env), meterId, await request.json()));
      if (method === "DELETE") {
        await deleteMeter(getSupabaseAdmin(env), meterId);
        return json({ success: true });
      }
    }

    // ── API Keys ────────────────────────────────────────
    const siteKeysMatch = path.match(/^\/api\/sites\/([^/]+)\/keys$/);
    if (siteKeysMatch) {
      const siteId = siteKeysMatch[1];
      if (method === "GET") return json(await getApiKeysForSite(getSupabase(env), siteId));
      if (method === "POST") return json(await createApiKey(getSupabaseAdmin(env), { site_id: siteId, ...await request.json() }), 201);
    }

    const keyMatch = path.match(/^\/api\/keys\/([^/]+)$/);
    if (keyMatch && method === "DELETE") {
      await deleteApiKey(getSupabaseAdmin(env), keyMatch[1]);
      return json({ success: true });
    }

    // ── Readings ────────────────────────────────────────
    const siteReadingsMatch = path.match(/^\/api\/sites\/([^/]+)\/readings$/);
    if (siteReadingsMatch && method === "GET") {
      const siteId = siteReadingsMatch[1];
      const from = url.searchParams.get("from");
      const to = url.searchParams.get("to");
      const limit = url.searchParams.get("limit");
      return json(await getReadingsForSite(getSupabase(env), siteId, {
        from: from || undefined,
        to: to || undefined,
        limit: limit ? parseInt(limit) : undefined,
      }));
    }

    const siteLatestReadingMatch = path.match(/^\/api\/sites\/([^/]+)\/readings\/latest$/);
    if (siteLatestReadingMatch && method === "GET") {
      return json(await getLatestReading(getSupabase(env), siteLatestReadingMatch[1]));
    }

    // ── SMTP Settings ───────────────────────────────────
    if (path === "/api/smtp" && method === "GET") {
      return json(await getSmtpSettings(getSupabase(env)));
    }
    if (path === "/api/smtp" && (method === "PUT" || method === "POST")) {
      return json(await upsertSmtpSettings(getSupabaseAdmin(env), await request.json()));
    }

    // ── Report Send Log ─────────────────────────────────
    const siteReportsMatch = path.match(/^\/api\/sites\/([^/]+)\/reports$/);
    if (siteReportsMatch) {
      const siteId = siteReportsMatch[1];
      if (method === "GET") {
        const limit = url.searchParams.get("limit");
        return json(await getReportLog(getSupabase(env), siteId, limit ? parseInt(limit) : 50));
      }
      if (method === "POST") return json(await logReport(getSupabaseAdmin(env), { site_id: siteId, ...await request.json() }), 201);
    }

    return json({ error: "Endpoint not found" }, 404);
  } catch (err: any) {
    console.error("API Error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
