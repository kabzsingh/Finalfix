import { createServerFn } from "@tanstack/react-start";
import { getCookie, setCookie, deleteCookie } from "@tanstack/react-start/server";
import { getServerContext } from "./server-utils";

const TOKEN_COOKIE_NAME = "sb-access-token";
const REFRESH_COOKIE_NAME = "sb-refresh-token";

export const getSession = createServerFn({ method: "GET" }).handler(async () => {
  const { supabase } = getServerContext();

  const accessToken = getCookie(TOKEN_COOKIE_NAME);
  const refreshToken = getCookie(REFRESH_COOKIE_NAME);

  if (!accessToken) {
    return { session: null };
  }

  const { data, error } = await supabase.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken || "",
  });

  if (error || !data.session) {
    return { session: null };
  }

  return { session: data.session };
});

export const signIn = createServerFn({ method: "POST" })
  .inputValidator((d: { accessToken: string; refreshToken: string }) => d)
  .handler(async ({ data }) => {
    // signIn only sets cookies — no Supabase client needed here.
    const isProd = process.env.NODE_ENV === "production";

    setCookie(TOKEN_COOKIE_NAME, data.accessToken, {
      path: "/",
      httpOnly: true,
      secure: isProd,
      sameSite: "lax",
      maxAge: 60 * 60 * 24 * 7,
    });

    if (data.refreshToken) {
      setCookie(REFRESH_COOKIE_NAME, data.refreshToken, {
        path: "/",
        httpOnly: true,
        secure: isProd,
        sameSite: "lax",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return { success: true };
  });

export const signOut = createServerFn({ method: "POST" }).handler(async () => {
  deleteCookie(TOKEN_COOKIE_NAME, { path: "/" });
  deleteCookie(REFRESH_COOKIE_NAME, { path: "/" });
  return { success: true };
});
