import { createFileRoute } from "@tanstack/react-router";
import { getRuntimeEnv } from "@/lib/runtime-env";
import { runSendReports } from "@/lib/send-reports";
import type { Env } from "@/lib/supabase";

export const Route = createFileRoute("/api/public/hooks/send-reports")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const env = getRuntimeEnv();
        const url = new URL(request.url);
        const force = url.searchParams.get("force");
        const result = await runSendReports(env as Env, force);
        if (!result.ok) return Response.json(result, { status: 500 });
        return Response.json(result);
      },
      GET: async () => Response.json({ ok: true, hint: "POST to trigger" }),
    },
  },
});
