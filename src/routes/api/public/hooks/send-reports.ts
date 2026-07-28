import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { runSendReports } from "@/lib/send-reports";
import type { Env } from "@/lib/supabase";

function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export const Route = createFileRoute("/api/public/hooks/send-reports")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: corsHeaders() }),
      POST: async ({ request }) => {
        const env = getRuntimeEnv();
        const url = new URL(request.url);
        const force = url.searchParams.get("force");
        const result = await runSendReports(env as Env, force);
        return Response.json(result, { status: result.ok ? 200 : 500, headers: corsHeaders() });
      },
      GET: async () => Response.json({ ok: true, hint: "POST to trigger" }, { headers: corsHeaders() }),
    },
  },
});
