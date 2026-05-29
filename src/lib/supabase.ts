import { createClient, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

export interface Env {
  SUPABASE_URL: string;
  SUPABASE_PUBLISHABLE_KEY: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
  // Back-compat aliases (some envs may still provide these names)
  SUPABASE_ANON_KEY?: string;
  SUPABASE_SERVICE_KEY?: string;
  NODE_ENV?: string;
  [key: string]: any;
}

function anonKey(env: Env): string {
  return env.SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_ANON_KEY!;
}

function serviceKey(env: Env): string {
  return env.SUPABASE_SERVICE_ROLE_KEY || env.SUPABASE_SERVICE_KEY!;
}

export function getSupabase(env: Env): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, anonKey(env), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export function getSupabaseAdmin(env: Env): SupabaseClient<Database> {
  return createClient<Database>(env.SUPABASE_URL, serviceKey(env), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
