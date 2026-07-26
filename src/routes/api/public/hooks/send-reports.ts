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
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const force = url.searchParams.get("force");
        // Temporary mobile-friendly diagnostic path: requires both `force`
        // (a specific site id) and `confirm=yes` so a plain GET / crawler
        // hit never accidentally triggers a real send. Remove once the
        // report-sending issue is confirmed fixed.
        if (force && url.searchParams.get("confirm") === "yes") {
          const env = getRuntimeEnv();
          const result = await runSendReports(env as Env, force);
          if (!result.ok) return Response.json(result, { status: 500 });
          return Response.json(result);
        }
        return Response.json({ ok: true, hint: "POST to trigger, or GET with ?force=<site_id>&confirm=yes" });
      },
    },
  },
});
