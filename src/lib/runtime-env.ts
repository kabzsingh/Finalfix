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
  const url =
    (typeof process !== "undefined" && process.env?.SUPABASE_URL) || "";
  const pub =
    (typeof process !== "undefined" && process.env?.SUPABASE_PUBLISHABLE_KEY) || "";
  const svc =
    (typeof process !== "undefined" && process.env?.SUPABASE_SERVICE_ROLE_KEY) || "";

  if (!url) {
    throw new Error(
      "SUPABASE_URL is not set. Add it as a Plaintext variable in Cloudflare Workers → Settings → Variables & Secrets."
    );
  }

  return {
    SUPABASE_URL: url,
    SUPABASE_PUBLISHABLE_KEY: pub,
    SUPABASE_SERVICE_ROLE_KEY: svc,
    NODE_ENV: (typeof process !== "undefined" && process.env?.NODE_ENV) || "production",
  };
}
