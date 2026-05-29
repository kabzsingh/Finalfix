import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Robust SHA-256 hashing using Web Crypto API (native in Cloudflare Workers)
 */
export async function sha256(message: string) {
  const msgUint8 = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", msgUint8);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Users & Roles ──────────────────────────────────────
export async function getUserRole(db: Client, userId: string) {
  const { data, error } = await db
    .from("user_roles")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── Sites ──────────────────────────────────────────────
export async function getSites(db: Client) {
  const { data, error } = await db.from("sites").select("*").order("name");
  if (error) throw error;
  return data;
}

export async function getSiteById(db: Client, id: string) {
  const { data, error } = await db.from("sites").select("*").eq("id", id).single();
  if (error) throw error;
  return data;
}

export async function createSite(db: Client, site: Database["public"]["Tables"]["sites"]["Insert"]) {
  const { data, error } = await db.from("sites").insert(site).select().single();
  if (error) throw error;
  return data;
}

export async function updateSite(db: Client, id: string, updates: Database["public"]["Tables"]["sites"]["Update"]) {
  const { data, error } = await db.from("sites").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteSite(db: Client, id: string) {
  const { error } = await db.from("sites").delete().eq("id", id);
  if (error) throw error;
}

// ── Site Meters ────────────────────────────────────────
export async function getMetersForSite(db: Client, siteId: string) {
  const { data, error } = await db.from("site_meters").select("*").eq("site_id", siteId).order("position");
  if (error) throw error;
  return data;
}

export async function createMeter(db: Client, meter: Database["public"]["Tables"]["site_meters"]["Insert"]) {
  const { data, error } = await db.from("site_meters").insert(meter).select().single();
  if (error) throw error;
  return data;
}

export async function updateMeter(db: Client, id: string, updates: Database["public"]["Tables"]["site_meters"]["Update"]) {
  const { data, error } = await db.from("site_meters").update(updates).eq("id", id).select().single();
  if (error) throw error;
  return data;
}

export async function deleteMeter(db: Client, id: string) {
  const { error } = await db.from("site_meters").delete().eq("id", id);
  if (error) throw error;
}

// ── Site API Keys ──────────────────────────────────────
export async function getApiKeyByHash(db: Client, hash: string) {
  const { data, error } = await db.from("site_api_keys").select("*, sites(*)").eq("key_hash", hash).single();
  if (error) throw error;
  return data;
}

export async function getApiKeysForSite(db: Client, siteId: string) {
  const { data, error } = await db.from("site_api_keys").select("*").eq("site_id", siteId).order("created_at", { ascending: false });
  if (error) throw error;
  return data;
}

export async function createApiKey(db: Client, entry: Database["public"]["Tables"]["site_api_keys"]["Insert"]) {
  const { data, error } = await db.from("site_api_keys").insert(entry).select().single();
  if (error) throw error;
  return data;
}

export async function deleteApiKey(db: Client, id: string) {
  const { error } = await db.from("site_api_keys").delete().eq("id", id);
  if (error) throw error;
}

// ── Readings (live sensor data) ────────────────────────
export async function insertReading(db: Client, reading: Database["public"]["Tables"]["readings"]["Insert"]) {
  const { data, error } = await db.from("readings").insert(reading).select().single();
  if (error) throw error;
  return data;
}

export async function insertReadings(db: Client, readings: Database["public"]["Tables"]["readings"]["Insert"][]) {
  const { data, error } = await db.from("readings").insert(readings).select();
  if (error) throw error;
  return data;
}

export async function getReadingsForSite(
  db: Client,
  siteId: string,
  options?: { limit?: number; from?: string; to?: string }
) {
  let query = db.from("readings").select("*").eq("site_id", siteId).order("recorded_at", { ascending: false });
  if (options?.from) query = query.gte("recorded_at", options.from);
  if (options?.to) query = query.lte("recorded_at", options.to);
  if (options?.limit) query = query.limit(options.limit);
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

export async function getLatestReading(db: Client, siteId: string) {
  const { data, error } = await db
    .from("readings")
    .select("*")
    .eq("site_id", siteId)
    .order("recorded_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// ── SMTP Settings ──────────────────────────────────────
export async function getSmtpSettings(db: Client) {
  const { data, error } = await db.from("smtp_settings").select("*").eq("id", true).maybeSingle();
  if (error) throw error;
  return data;
}

export async function upsertSmtpSettings(db: Client, settings: any) {
  const { data, error } = await db.from("smtp_settings").upsert({ ...settings, id: true }).select().single();
  if (error) throw error;
  return data;
}

// ── Report Send Log ────────────────────────────────────
export async function logReport(db: Client, entry: Database["public"]["Tables"]["report_send_log"]["Insert"]) {
  const { data, error } = await db.from("report_send_log").insert(entry).select().single();
  if (error) throw error;
  return data;
}

export async function getReportLog(db: Client, siteId: string, limit = 50) {
  const { data, error } = await db
    .from("report_send_log")
    .select("*")
    .eq("site_id", siteId)
    .order("sent_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data;
}
