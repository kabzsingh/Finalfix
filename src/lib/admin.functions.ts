import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { getSupabaseAdmin, type Env } from "@/lib/supabase";
import { getRuntimeEnv } from "@/lib/runtime-env";
import {
  getUserRole,
  getSmtpSettings as dbGetSmtpSettings,
  upsertSmtpSettings as dbUpsertSmtpSettings,
  createApiKey as dbCreateApiKey,
  createSite,
  createMeter,
} from "@/lib/db";
import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { z } from "zod";

type AuthSupabase = SupabaseClient<Database>;

async function assertAdmin(supabase: AuthSupabase, userId: string) {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("role", "admin")
    .maybeSingle();

  if (error) throw new Error(error.message || "Admin check failed");
  if (!data) throw new Response("Forbidden", { status: 403 });
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

type BootstrapResult = { granted: boolean; is_admin: boolean };

async function bootstrapViaRpc(
  supabase: AuthSupabase,
): Promise<{ granted: boolean; isAdmin: boolean }> {
  try {
    const { data, error } = await supabase.rpc("bootstrap_first_admin");
    if (error) throw error;
    const row = data as BootstrapResult | null;
    return { granted: row?.granted ?? false, isAdmin: row?.is_admin ?? false };
  } catch (e: any) {
    console.warn("[Bootstrap] RPC method failed, might not be installed:", e.message);
    return { granted: false, isAdmin: false };
  }
}

/** Fallback when migration not applied yet — needs SUPABASE_SERVICE_ROLE_KEY in env. */
async function bootstrapViaServiceRole(
  env: Env,
  userId: string,
): Promise<{ granted: boolean; isAdmin: boolean }> {
  const dbAdmin = getSupabaseAdmin(env);

  const { count, error: cErr } = await dbAdmin
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("role", "admin");

  if (cErr) throw new Error("Database error while checking admins: " + cErr.message);

  if ((count ?? 0) > 0) {
    const roleRow = await getUserRole(dbAdmin, userId);
    return { granted: false, isAdmin: roleRow?.role === "admin" };
  }

  const { error } = await dbAdmin.from("user_roles").insert({ user_id: userId, role: "admin" });
  if (error) throw new Error("Failed to grant admin role: " + error.message);
  return { granted: true, isAdmin: true };
}

export const createSiteApiKey = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { siteId: string; label?: string }) =>
    z.object({ siteId: z.string(), label: z.string().max(60).optional() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const parsed = data;

    await assertAdmin(context.supabase, context.userId);
    const { siteId, label } = parsed;

    const bytes = new Uint8Array(24);
    globalThis.crypto.getRandomValues(bytes);
    const hex = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const raw = "ws_live_" + hex;
    const hash = await sha256(raw);
    const prefix = raw.slice(0, 12);

    await dbCreateApiKey(context.supabase, {
      site_id: siteId,
      key_hash: hash,
      key_prefix: prefix,
      label: label || "ESP32",
    });

    return { apiKey: raw, prefix };
  });

export const getSmtpSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    return await dbGetSmtpSettings(context.supabase);
  });

export const updateSmtpSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: {
    host: string; port: number; user_email: string; password: string;
    from_name: string; from_email: string; encryption: "tls" | "ssl" | "none";
  }) =>
    z.object({
      host: z.string(),
      port: z.number(),
      user_email: z.string().email(),
      password: z.string(),
      from_name: z.string(),
      from_email: z.string().email(),
      encryption: z.enum(["tls", "ssl", "none"]),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    const parsed = data;

    await assertAdmin(context.supabase, context.userId);
    await dbUpsertSmtpSettings(context.supabase, {
      ...parsed,
      updated_at: new Date().toISOString(),
    });
    return { ok: true };
  });

  export const grantAdminBootstrap = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { __token: string }) => data)
  .handler(async ({ context }) => {  
  const env = getRuntimeEnv();

    try {
      // 1. Try using Service Role (Automated, bypasses RLS)
      return await bootstrapViaServiceRole(env, context.userId);
    } catch (svcErr: any) {
      // 2. If Service Role key is missing or blocked, try the RPC method
      console.warn("[Admin] Service role bootstrap failed, trying RPC:", svcErr.message);
      return await bootstrapViaRpc(context.supabase);
    }
  });

export const seedDemoData = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const { data: existing } = await context.supabase.from("sites").select("id").limit(1);
    if (existing && existing.length > 0) return { seeded: false };

    const sitesToCreate = [
      { name: "North Bay Wash", location: "Manchester, UK" },
      { name: "Riverside Auto", location: "Bristol, UK" },
    ];

    for (const s of sitesToCreate) {
      const site = await createSite(context.supabase, s);

      const meters = [
        {
          meter_type: "wash" as const,
          name: "Wash bay",
          unit: "count",
          device_key: "wash",
          position: 0,
          capacity: null,
          low_threshold: null,
        },
        {
          meter_type: "chemical" as const,
          name: "Soap",
          unit: "L",
          device_key: "chem1",
          position: 2,
          capacity: 200,
          low_threshold: 40,
        },
      ];

      for (const m of meters) {
        await createMeter(context.supabase, { ...m, site_id: site!.id });
      }
    }
    return { seeded: true };
  });

// ── User approval & role management ─────────────────────
export const listAllUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await assertAdmin(context.supabase, context.userId);
    const env = getRuntimeEnv();
    const admin = getSupabaseAdmin(env);

    const { data: authList, error: aErr } = await admin.auth.admin.listUsers({ perPage: 200 });
    if (aErr) throw new Error(aErr.message);

    const { data: roles } = await admin.from("user_roles").select("user_id, role");
    const rolesByUser = new Map<string, string[]>();
    (roles ?? []).forEach((r) => {
      const arr = rolesByUser.get(r.user_id) ?? [];
      arr.push(r.role as string);
      rolesByUser.set(r.user_id, arr);
    });

    return authList.users.map((u) => ({
      id: u.id,
      email: u.email ?? "",
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at ?? null,
      roles: rolesByUser.get(u.id) ?? [],
    }));
  });

export const setUserRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string; role: "admin" | "operator" | "none" }) =>
    z.object({
      userId: z.string().uuid(),
      role: z.enum(["admin", "operator", "none"]),
    }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    const env = getRuntimeEnv();
    const admin = getSupabaseAdmin(env);

    // Clear existing roles
    const { error: delErr } = await admin.from("user_roles").delete().eq("user_id", data.userId);
    if (delErr) throw new Error(delErr.message);

    if (data.role !== "none") {
      const { error: insErr } = await admin
        .from("user_roles")
        .insert({ user_id: data.userId, role: data.role });
      if (insErr) throw new Error(insErr.message);
    }
    return { ok: true };
  });

export const deleteUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: { userId: string }) =>
    z.object({ userId: z.string().uuid() }).parse(data),
  )
  .handler(async ({ data, context }) => {
    await assertAdmin(context.supabase, context.userId);
    if (data.userId === context.userId) {
      throw new Error("You cannot delete your own account");
    }
    const env = getRuntimeEnv();
    const admin = getSupabaseAdmin(env);
    const { error } = await admin.auth.admin.deleteUser(data.userId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

