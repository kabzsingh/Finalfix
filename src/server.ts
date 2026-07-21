import "./lib/error-capture";

import { consumeLastCapturedError } from "./lib/error-capture";
import { renderErrorPage } from "./lib/error-page";
import { handleApiRequest } from "./api/index";
import { type Env } from "./lib/supabase";
import { setRuntimeEnv } from "./lib/runtime-env";
import { runSendReports } from "./lib/send-reports";

type ServerEntry = {
  fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> | Response;
};

let serverEntryPromise: Promise<ServerEntry> | undefined;

async function getServerEntry(): Promise<ServerEntry> {
  if (!serverEntryPromise) {
    serverEntryPromise = import("@tanstack/react-start/server-entry").then(
      (m) => ((m as { default?: ServerEntry }).default ?? (m as unknown as ServerEntry)),
    );
  }
  return serverEntryPromise;
}

function brandedErrorResponse(): Response {
  return new Response(renderErrorPage(), {
    status: 500,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function isCatastrophicSsrErrorBody(body: string, responseStatus: number): boolean {
  let payload: unknown;
  try {
    payload = JSON.parse(body);
  } catch {
    return false;
  }

  if (!payload || Array.isArray(payload) || typeof payload !== "object") {
    return false;
  }

  const fields = payload as Record<string, unknown>;
  const expectedKeys = new Set(["message", "status", "unhandled"]);
  if (!Object.keys(fields).every((key) => expectedKeys.has(key))) {
    return false;
  }

  return (
    fields.unhandled === true &&
    fields.message === "HTTPError" &&
    (fields.status === undefined || fields.status === responseStatus)
  );
}

// h3 swallows in-handler throws into a normal 500 Response with body
// {"unhandled":true,"message":"HTTPError"} — try/catch alone never fires for those.
async function normalizeCatastrophicSsrResponse(response: Response): Promise<Response> {
  if (response.status < 500) return response;
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) return response;

  const body = await response.clone().text();
  if (!isCatastrophicSsrErrorBody(body, response.status)) {
    return response;
  }

  console.error(consumeLastCapturedError() ?? new Error(`h3 swallowed SSR error: ${body}`));
  return brandedErrorResponse();
}

export default {
  async fetch(request: Request, env: unknown, ctx: unknown) {
    // Make Cloudflare env vars available to all server functions via getRuntimeEnv()
    setRuntimeEnv(env as Env);

    const url = new URL(request.url);

    // ── Legacy API routes (Supabase) ─────────────────────────
    if (url.pathname.startsWith("/api/") && !url.pathname.startsWith("/api/public/")) {
      return handleApiRequest(request, env as Env);
    }

    try {
      const handler = await getServerEntry();
      const response = await handler.fetch(request, env, ctx);
      return await normalizeCatastrophicSsrResponse(response);
    } catch (error) {
      console.error(error);
      return brandedErrorResponse();
    }
  },

  async scheduled(_event: unknown, env: unknown, _ctx: unknown) {
    setRuntimeEnv(env as Env);

    // Previously this made an HTTP request back to the worker's own URL to
    // trigger report sending — but that URL had to be guessed (or manually
    // configured via WORKER_BASE_URL/WORKER_URL), and if it didn't match the
    // actual deployed worker, the request silently failed every hour with
    // nothing visible outside Cloudflare's own logs. Calling the report logic
    // directly removes that failure mode entirely.
    try {
      const result = await runSendReports(env as Env);
      console.log("Cron send-reports:", JSON.stringify(result));
    } catch (e) {
      console.error("Cron send-reports failed:", e);
    }
  },
};
