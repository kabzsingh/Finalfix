import { createStart, createMiddleware } from "@tanstack/react-start";

import { supabase } from "@/integrations/supabase/client";
import { renderErrorPage } from "./lib/error-page";

const errorMiddleware = createMiddleware().server(async ({ next }) => {
  try {
    return await next();
  } catch (error) {
    if (error != null && typeof error === "object" && "statusCode" in error) {
      throw error;
    }
    console.error(error);
    return new Response(renderErrorPage(), {
      status: 500,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
});

/** Attach Supabase access token so `requireSupabaseAuth` succeeds on `createServerFn` calls from the browser. */
const supabaseServerFnAuth = createMiddleware({ type: "function" }).client(
  async ({ next }) => {
    if (typeof window === "undefined") return next();
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (!token) return next();
    return next({
      headers: { Authorization: `Bearer ${token}` },
    });
  },
);

export const startInstance = createStart(() => ({
  requestMiddleware: [errorMiddleware],
  functionMiddleware: [supabaseServerFnAuth],
}));
