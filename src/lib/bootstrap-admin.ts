import { supabase } from "@/integrations/supabase/client";

export type BootstrapAdminResult = { granted: boolean; isAdmin: boolean };

function parseRpcResult(data: unknown): BootstrapAdminResult {
  const row = data as { granted?: boolean; is_admin?: boolean } | null;
  return { granted: !!row?.granted, isAdmin: !!row?.is_admin };
}

function isMissingRpcError(error: { code?: string; message?: string; status?: number } | null) {
  if (!error) return false;
  return (
    error.code === "PGRST202" ||
    error.status === 404 ||
    (error.message?.includes("bootstrap_first_admin") ?? false)
  );
}

/** Grant admin to the current user when no admin exists yet (client session required). */
export async function bootstrapAdminAccess(userId: string): Promise<BootstrapAdminResult> {
  const { data: rpcData, error: rpcError } = await supabase.rpc("bootstrap_first_admin");
  if (!rpcError) return parseRpcResult(rpcData);

  if (!isMissingRpcError(rpcError)) throw rpcError;

  const { error: insertError } = await supabase.from("user_roles").insert({
    user_id: userId,
    role: "admin",
  });

  if (!insertError) return { granted: true, isAdmin: true };

  if (insertError.code === "42501") {
    const err = new Error(insertError.message);
    (err as Error & { code: string }).code = "42501";
    throw err;
  }

  const { data: roles } = await supabase.from("user_roles").select("role").eq("user_id", userId);
  const isAdminNow = (roles ?? []).some((r) => r.role === "admin");
  return { granted: false, isAdmin: isAdminNow };
}

export function isSetupRequiredError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: string; message?: string };
  return (
    e.code === "42501" ||
    (e.message?.includes("row-level security") ?? false) ||
    (e.message?.includes("bootstrap_first_admin") ?? false)
  );
}
