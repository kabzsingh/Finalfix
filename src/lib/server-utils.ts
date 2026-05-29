import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { type Env, getSupabase, getSupabaseAdmin } from "./supabase";
import { getRuntimeEnv } from "./runtime-env";

export function getServerContext() {
  if (!import.meta.env.SSR) {
    throw new Error("getServerContext can only be called on the server.");
  }
  const env: Env = getRuntimeEnv();
  return {
    env,
    supabase: getSupabase(env),
    supabaseAdmin: getSupabaseAdmin(env),
    getCookie,
    setCookie,
    deleteCookie,
  };
}
