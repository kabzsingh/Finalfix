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

    // ── Email Reports (called by cron hourly) ──────────────
    if (path === "/api/public/hooks/send-reports" && method === "POST") {
      const resendApiKey = (env as any).RESEND_API_KEY;
      
      if (!resendApiKey) {
        return json({ error: "RESEND_API_KEY not configured" }, 400);
      }

      // Get all sites with email subscriptions
      const admin = getSupabaseAdmin(env);
      const { data: subscriptions, error: subError } = await admin
        .from("email_subscriptions")
        .select("*");
      
      if (subError) {
        return json({ error: subError.message }, 500);
      }

      if (!subscriptions || subscriptions.length === 0) {
        return json({ ok: true, sent: 0, message: "No subscriptions" });
      }

      let sent = 0;
      const errors = [];

      for (const sub of subscriptions) {
        try {
          // Get latest readings for this site
          const { data: readings } = await admin
            .from("readings")
            .select("meter_id, value, recorded_at")
            .eq("site_id", sub.site_id)
            .order("recorded_at", { ascending: false })
            .limit(50);

          // Get site details
          const { data: site } = await admin
            .from("sites")
            .select("name, location")
            .eq("id", sub.site_id)
            .single();

          // Get meters
          const { data: meters } = await admin
            .from("meters")
            .select("id, name, meter_type, unit")
            .eq("site_id", sub.site_id);

          const meterMap = new Map(meters?.map((m: any) => [m.id, m]) || []);
          const summaryReadings = readings?.slice(0, 10) || [];
          
          const siteName = site?.name || sub.site_id;
          const siteLocation = site?.location || "Unknown location";

          // Build email HTML
          const readingsHtml = summaryReadings.map((r: any) => {
            const meter = meterMap.get(r.meter_id);
            const meterName = meter?.name || "Unknown meter";
            const meterType = meter?.meter_type || "unknown";
            
            let displayValue = String(r.value);
            if (meterType === "chemical") {
              displayValue = Number(r.value) >= 1 ? "🔴 LOW" : "🟢 OK";
            } else if (meterType === "wash") {
              displayValue = `${Math.round(Number(r.value))} washes`;
            } else if (meterType === "fresh_water") {
              displayValue = `${Number(r.value).toFixed(1)}L`;
            }

            return `
              <tr style="border-bottom: 1px solid #eee; padding: 10px 0;">
                <td style="padding: 8px; font-weight: 500;">${meterName}</td>
                <td style="padding: 8px; text-align: right;">${displayValue}</td>
              </tr>
            `;
          }).join("");

          const htmlContent = `
            <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
              <div style="background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px 8px 0 0; text-align: center;">
                <h1 style="margin: 0; font-size: 28px;">📊 Daily Report</h1>
                <p style="margin: 10px 0 0 0; font-size: 16px; opacity: 0.9;">${siteName}</p>
              </div>
              
              <div style="background: #f9f9f9; padding: 20px; border-radius: 0 0 8px 8px; border: 1px solid #eee; border-top: none;">
                <p style="margin: 0 0 15px 0; color: #666;">
                  <strong>Location:</strong> ${siteLocation}<br>
                  <strong>Generated:</strong> ${new Date().toLocaleString()}
                </p>

                <h2 style="margin: 20px 0 10px 0; font-size: 16px; color: #333;">Recent Readings</h2>
                <table style="width: 100%; border-collapse: collapse;">
                  ${readingsHtml}
                </table>

                <p style="margin: 20px 0 0 0; padding-top: 20px; border-top: 1px solid #ddd; color: #999; font-size: 12px;">
                  This is an automated report from WashGrid. <a href="https://auto.washdashboard.workers.dev/" style="color: #667eea; text-decoration: none;">View dashboard</a>
                </p>
              </div>
            </div>
          `;

          // Send via Resend API
          const resendResponse = await fetch("https://api.resend.com/emails", {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${resendApiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              from: "WashGrid <onboarding@resend.dev>",
              to: sub.email,
              subject: `WashGrid Daily Report: ${siteName}`,
              html: htmlContent,
            }),
          });

          const resendData = await resendResponse.json() as any;

          if (resendResponse.ok && resendData.id) {
            sent++;
            await logReport(admin, {
              site_id: sub.site_id,
              sent_to: sub.email,
              status: "success",
              message: `Email sent via Resend: ${resendData.id}`,
            });
          } else {
            const errorMsg = resendData.message || "Unknown error";
            errors.push(`Failed to send to ${sub.email}: ${errorMsg}`);
          }
        } catch (e: any) {
          errors.push(`Error processing ${sub.site_id}: ${e.message}`);
        }
      }

      return json({
        ok: true,
        sent,
        total: subscriptions.length,
        errors: errors.length > 0 ? errors : undefined,
      });
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
