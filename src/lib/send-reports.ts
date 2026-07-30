import { getSupabaseAdmin, type Env } from "@/lib/supabase";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import * as XLSX from "xlsx";

type Client = SupabaseClient<Database>;

async function sendEmail(
  to: string[],
  subject: string,
  text: string,
  attachment: { filename: string; mime: string; contentBase64: string },
  sendgridApiKey: string,
  fromEmail: string,
  fromName: string,
) {
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${sendgridApiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: { email: fromEmail, name: fromName },
      personalizations: [{ to: to.map((email) => ({ email })) }],
      subject,
      content: [{ type: "text/plain", value: text }],
      attachments: [
        {
          filename: attachment.filename,
          content: attachment.contentBase64,
          type: attachment.mime,
        },
      ],
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`SendGrid error: ${err}`);
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

async function fetchHourlyAgg(db: Client, siteId: string, fromIso: string, toIso: string) {
  const { data, error } = await db.rpc("report_hourly_agg", { _site_id: siteId, _from: fromIso, _to: toIso });
  if (error) throw new Error(error.message);
  return (data ?? []) as { meter_id: string; hour_bucket: number; sum_value: number; count_value: number; last_value: number }[];
}

async function fetchDailyAgg(db: Client, siteId: string, fromIso: string, toIso: string, tz: string) {
  const { data, error } = await db.rpc("report_daily_agg", { _site_id: siteId, _from: fromIso, _to: toIso, _tz: tz });
  if (error) throw new Error(error.message);
  return (data ?? []) as { meter_id: string; day_bucket: string; sum_value: number; count_value: number; last_value: number }[];
}

function addAggSheet(workbook: XLSX.WorkBook, sheetName: string, rows: (string | number)[][]) {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const colCount = rows.reduce((max, r) => Math.max(max, r.length), 0);
  const widths: { wch: number }[] = [];
  for (let c = 0; c < colCount; c++) {
    let maxLen = 8;
    for (const row of rows) {
      const cell = row[c];
      if (cell != null) maxLen = Math.max(maxLen, String(cell).length);
    }
    widths.push({ wch: Math.min(maxLen + 2, 45) });
  }
  ws["!cols"] = widths;
  const safeName = sheetName.replace(/[\[\]:*?/\\]/g, "").slice(0, 31);
  XLSX.utils.book_append_sheet(workbook, ws, safeName);
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
  const readingsAgg = await fetchHourlyAgg(db, site.id, fromIso, toIso);
  const buckets = new Map<string, Map<string, { sum: number; count: number; last: number }>>();
  for (const row of readingsAgg) {
    const hourKey = `${String(row.hour_bucket).padStart(2, "0")}:00`;
    if (!buckets.has(hourKey)) buckets.set(hourKey, new Map());
    buckets.get(hourKey)!.set(row.meter_id, { sum: Number(row.sum_value), count: Number(row.count_value), last: Number(row.last_value) });
  }
  const hours = Array.from({ length: 24 }, (_, i) => `${String(i).padStart(2, "0")}:00`);
  const header: (string | number)[] = ["hour", ...meters.map((m) => `${m.name} (${m.unit || m.meter_type})`)];
  const rows: (string | number)[][] = [header];
  for (const h of hours) {
    const row: (string | number)[] = [h];
    for (const meter of meters) {
      const agg = buckets.get(h)?.get(meter.id);
      if (meter.meter_type === "wash") row.push(agg?.count ?? 0);
      else if (meter.meter_type === "fresh_water") row.push(Number((agg?.sum ?? 0).toFixed(2)));
      else row.push(agg ? Number(agg.last.toFixed(2)) : "");
    }
    rows.push(row);
  }

  const workbook = XLSX.utils.book_new();
  addAggSheet(workbook, "Hourly Breakdown", rows);
  const contentBase64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });

  const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
  return {
    subject: `Daily report — ${site.name} — ${ymd}`,
    text: `Daily report for ${site.name} — ${ymd}\n\nSee attached Excel file.`,
    periodKey: ymd,
    attachment: {
      filename: `${safeName}_daily_${ymd}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentBase64,
    },
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
  const fromIso = new Date(`${ym}-01T00:00:00`).toISOString();
  const toIso = new Date(prevYear, prevMonth, 1).toISOString();
  const readingsAgg = await fetchDailyAgg(db, site.id, fromIso, toIso, tz);
  const days = new Set<string>();
  const map = new Map<string, Map<string, { sum: number; count: number; last: number }>>();
  for (const row of readingsAgg) {
    const d = row.day_bucket;
    days.add(d);
    if (!map.has(d)) map.set(d, new Map());
    map.get(d)!.set(row.meter_id, { sum: Number(row.sum_value), count: Number(row.count_value), last: Number(row.last_value) });
  }
  const sortedDays = Array.from(days).sort();
  const header: (string | number)[] = ["date", ...meters.map((m) => `${m.name} (${m.unit || m.meter_type})`)];
  const rows: (string | number)[][] = [header];
  for (const d of sortedDays) {
    const row: (string | number)[] = [d];
    for (const meter of meters) {
      const agg = map.get(d)?.get(meter.id);
      if (meter.meter_type === "wash") row.push(agg?.count ?? 0);
      else if (meter.meter_type === "fresh_water") row.push(Number((agg?.sum ?? 0).toFixed(2)));
      else row.push(agg ? Number(agg.last.toFixed(2)) : "");
    }
    rows.push(row);
  }

  const workbook = XLSX.utils.book_new();
  addAggSheet(workbook, "Daily Breakdown", rows);
  const contentBase64 = XLSX.write(workbook, { bookType: "xlsx", type: "base64" });

  const safeName = site.name.replace(/[^a-z0-9]+/gi, "_");
  return {
    subject: `Monthly report — ${site.name} — ${ym}`,
    text: `Monthly report for ${site.name} — ${ym}\n\nSee attached Excel file.`,
    periodKey: ym,
    attachment: {
      filename: `${safeName}_monthly_${ym}.xlsx`,
      mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      contentBase64,
    },
  };
}

async function alreadySent(db: Client, siteId: string, type: "daily" | "monthly", periodKey: string) {
  const { data, error } = await db
    .from("report_send_log")
    .select("id")
    .eq("site_id", siteId)
    .eq("report_type", type)
    .eq("period_key", periodKey)
    .eq("status", "sent")
    .limit(1);
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

async function logReportAttempt(
  db: Client,
  siteId: string,
  type: "daily" | "monthly",
  periodKey: string,
  recipients: string[],
  ok: boolean,
  errorMsg?: string,
) {
  // Best-effort logging: if this fails, don't let it mask the real
  // send result — it's already been reported back to the caller.
  await db.from("report_send_log").insert({
    site_id: siteId,
    report_type: type,
    period_key: periodKey,
    recipients,
    status: ok ? "sent" : "failed",
    error: errorMsg ?? null,
  });
}

async function processSite(db: Client, site: any, sendgridApiKey: string) {
  const tz = site.timezone || "UTC";
  const local = nowInTz(tz);
  // GitHub Actions' scheduled runs are "best effort" and can land anywhere
  // from a few minutes to a few hours apart rather than exactly on the hour
  // — an exact hour match here meant a site's report_hour window could be
  // skipped entirely if no run happened to land within that specific hour.
  // Using >= instead catches up on the next run after the target hour,
  // relying on the report_send_log "already-sent" check below (keyed by
  // day) to prevent sending more than once per day once it does fire.
  if (local.hour < site.report_hour) return { site: site.name, skipped: "hour-not-reached" };
  const recipients: string[] = (site.report_recipients ?? []).filter((e: string) => /.+@.+\..+/.test(e));
  if (recipients.length === 0) return { site: site.name, skipped: "no-recipients" };
  const { data: meters, error: mErr } = await db.from("site_meters").select("*").eq("site_id", site.id).order("position");
  if (mErr) throw new Error(mErr.message);
  const results: any[] = [];
  const fromEmail = "autowashges@gmail.com";
  const fromName = "Autowash Dashboard Reports";
  if (site.daily_report_enabled) {
    const r = await buildDailyReport(db, site, meters ?? []);
    if (await alreadySent(db, site.id, "daily", r.periodKey)) {
      results.push({ type: "daily", period: r.periodKey, skipped: "already-sent" });
    } else {
      try {
        await sendEmail(recipients, r.subject, r.text, r.attachment, sendgridApiKey, fromEmail, fromName);
        await logReportAttempt(db, site.id, "daily", r.periodKey, recipients, true);
        results.push({ type: "daily", period: r.periodKey, ok: true });
      } catch (e: any) {
        await logReportAttempt(db, site.id, "daily", r.periodKey, recipients, false, e.message);
        results.push({ type: "daily", period: r.periodKey, ok: false, error: e.message });
      }
    }
  }
  if (site.monthly_report_enabled && local.day === 1) {
    const r = await buildMonthlyReport(db, site, meters ?? []);
    if (await alreadySent(db, site.id, "monthly", r.periodKey)) {
      results.push({ type: "monthly", period: r.periodKey, skipped: "already-sent" });
    } else {
      try {
        await sendEmail(recipients, r.subject, r.text, r.attachment, sendgridApiKey, fromEmail, fromName);
        await logReportAttempt(db, site.id, "monthly", r.periodKey, recipients, true);
        results.push({ type: "monthly", period: r.periodKey, ok: true });
      } catch (e: any) {
        await logReportAttempt(db, site.id, "monthly", r.periodKey, recipients, false, e.message);
        results.push({ type: "monthly", period: r.periodKey, ok: false, error: e.message });
      }
    }
  }
  return { site: site.name, results };
}

/**
 * Runs the daily/monthly report send job for all sites (or a single site if
 * `force` is passed). Shared by both the HTTP hook (manual/testing trigger)
 * and the cron `scheduled()` handler, so the scheduled job no longer depends
 * on making a self-referential HTTP request to a guessed worker URL.
 */
export async function runSendReports(env: Env, force?: string | null) {
  const db = getSupabaseAdmin(env);
  const sendgridApiKey = (env as any).SENDGRID_API_KEY;
  if (!sendgridApiKey) {
    return { ok: false, error: "SENDGRID_API_KEY is not set", processed: [] as any[] };
  }
  const { data: sites, error } = await db.from("sites").select("*");
  if (error) {
    return { ok: false, error: error.message, processed: [] as any[] };
  }
  const out: any[] = [];
  for (const site of sites ?? []) {
    if (force && site.id !== force) continue;
    try {
      const r = await processSite(
        db,
        force ? { ...site, report_hour: nowInTz(site.timezone || "UTC").hour } : site,
        sendgridApiKey,
      );
      out.push(r);
    } catch (e: any) {
      out.push({ site: site.name, error: e.message });
    }
  }
  return { ok: true, processed: out };
}
