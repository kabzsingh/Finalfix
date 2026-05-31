import { createFileRoute } from "@tanstack/react-router";
import { getSupabaseAdmin, type Env } from "@/lib/supabase";
import { getSmtpSettings } from "@/lib/db";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import nodemailer from "nodemailer";

type Client = SupabaseClient<Database>;

function b64url(s: string) {
  return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function sendEmail(
  db: Client,
  to: string[],
  subject: string,
  text: string,
  attachment: { filename: string; mime: string; content: string },
) {
  const smtp = await getSmtpSettings(db);

  if (smtp && smtp.host && smtp.user_email) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtp.host,
        port: smtp.port,
        secure: smtp.encryption === "ssl",
        auth: {
          user: smtp.user_email,
          pass: smtp.password,
        },
      });

      await transporter.sendMail({
        from: `"${smtp.from_name}" <${smtp.from_email}>`,
        to: to.join(", "),
        subject,
        text,
        attachments: [
          {
            filename: attachment.filename,
            content: attachment.content,
            contentType: attachment.mime,
          },
        ],
      });
      return;
    } catch (e: any) {
      console.error("SMTP send failed:", e);
      throw e;
    }
  } else {
    throw new Error("No SMTP settings configured. Please set them up in the Admin Console.");
  }
}

function nowInTz(tz: string, instant = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(instant).map((p) => [p.type, p.value]));
  return {
    hour: Number(parts.hour),
    day: Number(parts.day),
    ymd: `${parts.year}-${parts.month}-${parts.day}`,
    ym: `${parts.year}-${parts.month}`,
  };
}

function ymdInTz(tz: string, instant: Date) {
  return nowInTz(tz, instant).ymd;
}

function escapeCsv(v: any) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function fetchReadings(db: Client, siteId: string, fromIso: string, toIso: string) {
  const all: any[] = [];
  let from = 0;
  const PAGE = 1000;
  while (true) {
    const { data, error } = await db
      .from("readings")
      .select("meter_id,value,recorded_at")
      .eq("site_id", siteId)
      .gte("recorded_at", fromIso)
      .lt("recorded_at", toIso)
      .order("recorded_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;
    all.push(...data);
    if (data.length < PAGE) break;
    from += PAGE;
  }
  return all;
}

async function buildDailyReport(db: Client, site: any, meters: any[]) {
  const tz = site.timezone || "UTC";
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 3600_000);
  const ymd = ymdInTz(tz, yesterday);
  const startLocal = new Date(`${ymd}T00:00:00`);
  const endLocal = new Date(`${ymd}T23:59:59.999`);
  const fromIso = new Date(startLocal.toISOString()).toISOString();
  const toIso = new Date(endLocal.getTime() + 1).toISOString();

  const readings = await fetchReadings(db, site.id, fromIso, toIso);
  const buckets = new Map<string, Map<string, number[]>>();
  for (const r of readings) {
    const d = new Date(r.recorded_at);
    const hourKey = `${String(d.getUTCHours()).padStart(2, "0")}:00`;
    if (!buckets.has(hourKey)) buckets.set(hourKey, new Map());
    const inner = buckets.get(hourKey)!;
    const arr = inner.get(r.meter_id) ?? [];
    arr.push(Number(r.value));
    inner.set(r.meter_id, arr);
  }
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);

  const header = ["hour", ...meters.map((m) => `${m.name} (${m.unit || m.meter_type})`)];
  const lines = [header.map(escapeCsv).join(",")];
  for (const h of hours) {
    const row: any[] = [h];
    for (const meter of meters) {
      const vals = buckets.get(h)?.get(meter.id) ?? [];
      if (meter.meter_type === "wash") row.push(vals.length);
      else if (meter.meter_type === "fresh_water") row.push(vals.reduce((a, b) => a + b, 0).toFixed(2));
      else row.push(vals.length ? vals[vals.length - 1].toFixed(2) : "");
    }
    lines.push(row.map(escapeCsv).join(","));
  }
  const csv = lines.join("\n");

  const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
  const subject = `Daily report — ${site.name} — ${ymd}`;
  const text = `Daily report for ${site.name} — ${ymd}\n\nSee attached CSV.`;
  return {
    subject,
    text,
    periodKey: ymd,
    attachment: { filename: `${safeName}_daily_${ymd}.csv`, mime: "text/csv; charset=UTF-8", content: csv },
  };
}

async function buildMonthlyReport(db: Client, site: any, meters: any[]) {
  const tz = site.timezone || "UTC";
  const now = new Date();
  const localToday = nowInTz(tz, now);
  const [y, m] = localToday.ym.split("-").map(Number);
  const prevMonth = m === 1 ? 12 : m - 1;
  const prevYear = m === 1 ? y - 1 : y;
  const ym = `${prevYear}-${String(prevMonth).padStart(2, "0")}`;
  const startLocal = new Date(`${ym}-01T00:00:00`);
  const endLocal = new Date(prevYear, prevMonth, 1);
  const fromIso = startLocal.toISOString();
  const toIso = endLocal.toISOString();

  const readings = await fetchReadings(db, site.id, fromIso, toIso);
  const days = new Set<string>();
  const map = new Map<string, Map<string, number[]>>();
  for (const r of readings) {
    const d = ymdInTz(tz, new Date(r.recorded_at));
    days.add(d);
    if (!map.has(d)) map.set(d, new Map());
    const inner = map.get(d)!;
    const arr = inner.get(r.meter_id) ?? [];
    arr.push(Number(r.value));
    inner.set(r.meter_id, arr);
  }
  const sortedDays = Array.from(days).sort();

  const header = ["date", ...meters.map((m) => `${m.name} (${m.unit || m.meter_type})`)];
  const lines = [header.map(escapeCsv).join(",")];
  for (const d of sortedDays) {
    const row: any[] = [d];
    for (const meter of meters) {
      const vals = map.get(d)?.get(meter.id) ?? [];
      if (meter.meter_type === "wash") row.push(vals.length);
      else if (meter.meter_type === "fresh_water") row.push(vals.reduce((a, b) => a + b, 0).toFixed(2));
      else row.push(vals.length ? vals[vals.length - 1].toFixed(2) : "");
    }
    lines.push(row.map(escapeCsv).join(","));
  }
  const csv = lines.join("\n");

  const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
  const subject = `Monthly report — ${site.name} — ${ym}`;
  const text = `Monthly report for ${site.name} — ${ym}\n\nSee attached CSV.`;
  return {
    subject,
    text,
    periodKey: ym,
    attachment: { filename: `${safeName}_monthly_${ym}.csv`, mime: "text/csv; charset=UTF-8", content: csv },
  };
}

async function processSite(db: Client, site: any) {
  const tz = site.timezone || "UTC";
  const local = nowInTz(tz);
  if (local.hour !== site.report_hour) return { site: site.name, skipped: "hour-mismatch", localHour: local.hour };
  const recipients: string[] = (site.report_recipients ?? []).filter((e: string) => /.+@.+\..+/.test(e));
  if (recipients.length === 0) return { site: site.name, skipped: "no-recipients" };

  const { data: meters, error: mErr } = await db
    .from("site_meters").select("*").eq("site_id", site.id).order("position");
  if (mErr) throw new Error(mErr.message);

  const results: any[] = [];

  if (site.daily_report_enabled) {
    const r = await buildDailyReport(db, site, meters ?? []);
    const { error: dupErr } = await db
      .from("report_send_log")
      .insert({ site_id: site.id, report_type: "daily", period_key: r.periodKey, recipients });
    if (!dupErr) {
      try {
        await sendEmail(db, recipients, r.subject, r.text, r.attachment);
        results.push({ type: "daily", period: r.periodKey, ok: true });
      } catch (e: any) {
        await db.from("report_send_log")
          .update({ status: "failed", error: e.message })
          .eq("site_id", site.id).eq("report_type", "daily").eq("period_key", r.periodKey);
        results.push({ type: "daily", period: r.periodKey, ok: false, error: e.message });
      }
    } else {
      results.push({ type: "daily", period: r.periodKey, skipped: "already-sent" });
    }
  }

  if (site.monthly_report_enabled && local.day === 1) {
    const r = await buildMonthlyReport(db, site, meters ?? []);
    const { error: dupErr } = await db
      .from("report_send_log")
      .insert({ site_id: site.id, report_type: "monthly", period_key: r.periodKey, recipients });
    if (!dupErr) {
      try {
        await sendEmail(db, recipients, r.subject, r.text, r.attachment);
        results.push({ type: "monthly", period: r.periodKey, ok: true });
      } catch (e: any) {
        await db.from("report_send_log")
          .update({ status: "failed", error: e.message })
          .eq("site_id", site.id).eq("report_type", "monthly").eq("period_key", r.periodKey);
        results.push({ type: "monthly", period: r.periodKey, ok: false, error: e.message });
      }
    } else {
      results.push({ type: "monthly", period: r.periodKey, skipped: "already-sent" });
    }
  }

  return { site: site.name, results };
}

export const Route = createFileRoute("/api/public/hooks/send-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { getRuntimeEnv } = await import("@/lib/runtime-env");
        const env = getRuntimeEnv();
        const db = getSupabaseAdmin(env);

        const url = new URL(request.url);
        const force = url.searchParams.get("force");

        const { data: sites, error } = await db.from("sites").select("*");
        if (error) return Response.json({ error: error.message }, { status: 500 });

        const out: any[] = [];
        for (const site of sites ?? []) {
          if (force && site.id !== force) continue;
          try {
            const r = await processSite(db, force ? { ...site, report_hour: nowInTz(site.timezone || "UTC").hour } : site);
            out.push(r);
          } catch (e: any) {
            out.push({ site: site.name, error: e.message });
          }
        }
        return Response.json({ ok: true, processed: out });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to trigger" }),
    },
  },
});
