/**
 * runtime-env.ts
 *
 * Cloudflare Workers does NOT populate process.env at runtime.
 * Instead, env vars arrive as the `env` argument in the fetch handler.
 *
 * server.ts calls setRuntimeEnv(env) on every request so that server
 * functions (createServerFn) can call getRuntimeEnv() to get the live vars.
 */

import type { Env } from "./supabase";

let _runtimeEnv: Env | null = null;

export function setRuntimeEnv(env: Env) {
  _runtimeEnv = env;
}

export function getRuntimeEnv(): Env {
  if (_runtimeEnv) return _runtimeEnv;

  // Fallback: try process.env (works in local wrangler dev / Node)
  // Also try VITE_ prefixed vars for Vite dev server mode
  const url =
    (typeof process !== "undefined" && (
      process.env?.SUPABASE_URL ||
      process.env?.VITE_SUPABASE_URL
    )) ||
    (typeof import.meta !== "undefined" && (
      (import.meta as any).env?.SUPABASE_URL ||
      (import.meta as any).env?.VITE_SUPABASE_URL
    )) ||
    "";

  const pub =
    (typeof process !== "undefined" && (
      process.env?.SUPABASE_PUBLISHABLE_KEY ||
      process.env?.VITE_SUPABASE_PUBLISHABLE_KEY
    )) ||
    (typeof import.meta !== "undefined" && (
      (import.meta as any).env?.SUPABASE_PUBLISHABLE_KEY ||
      (import.meta as any).env?.VITE_SUPABASE_PUBLISHABLE_KEY
    )) ||
    "";

  const svc =
    (typeof process !== "undefined" && (
      process.env?.SUPABASE_SERVICE_ROLE_KEY
    )) ||
    (typeof import.meta !== "undefined" && (
      (import.meta as any).env?.SUPABASE_SERVICE_ROLE_KEY
    )) ||
    "";

  return {
    SUPABASE_URL: url || "https://fqunlzvwtxsfithghfhr.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: pub || "sb_publishable_i7s0-XEBWmHWGlxRV7Qbvg_sCC5Wi5u",
    SUPABASE_SERVICE_ROLE_KEY: svc,
    NODE_ENV: (typeof process !== "undefined" && process.env?.NODE_ENV) || "production",
  };
}
}
